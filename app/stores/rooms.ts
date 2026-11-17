import { defineStore } from 'pinia'
import type { ApiRoom, RoomRole } from '~/types/api'
import { linkTo, type Member, type RoomSignal } from '~/utils/mesh'
import { CALL_AUDIO, CallPeer, NETWORK_HINT, type Signal } from '~/utils/peer'
import { mediaErrorMessage, requestMedia } from '~/utils/recording'
import { TONES, playNotes } from '~/utils/tones'

/**
 * Group calls (project channels, everyone talks, up to 6) and announcements (one speaker, heard live by everyone
 * online in the audience, who joins automatically). The API keeps who is in a room and tells the audience when it
 * starts and ends (room.updated on private-channel.{id}, or presence-office for announcements to everyone).
 * In a room, everyone joins presence-room.{id}: its member list says whom to connect to (see utils/mesh.ts), and
 * WebRTC set-up goes through it as whispers addressed to one member.
 */
export type RoomPhase = 'idle' | 'joining' | 'live'

const HEARTBEAT_MS = 30_000
const RECOVER_MS = 12_000
const CONNECT_TIMEOUT_MS = 25_000
const INTERCOM_PICKUP_MS = 15_000

type PresenceChannel = {
  here: (cb: (members: PresenceMember[]) => void) => PresenceChannel
  joining: (cb: (m: PresenceMember) => void) => PresenceChannel
  leaving: (cb: (m: PresenceMember) => void) => PresenceChannel
  listenForWhisper: (event: string, cb: (e: never) => void) => PresenceChannel
  whisper: (event: string, data: unknown) => PresenceChannel
  error: (cb: (e: unknown) => void) => PresenceChannel
}
interface PresenceMember { id: string; display_name: string; role: RoomRole }

interface Link {
  peer: CallPeer
  offer: boolean
  restarted: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export const useRoomsStore = defineStore('rooms', () => {
  const chat = useChatStore()
  const calls = useCallStore()
  const profile = useProfileStore()
  const toast = useToast()
  const api = useApi()
  const auth = useAuth()
  const config = useRuntimeConfig()

  /** live rooms this person can see, by id */
  const live = ref<Record<string, ApiRoom>>({})
  /** the room we are in */
  const current = ref<ApiRoom | null>(null)
  const role = ref<RoomRole | null>(null)
  const phase = ref<RoomPhase>('idle')
  const muted = ref(false)
  const joinedAt = ref<number | null>(null)
  /** presence-room members other than us */
  const members = ref<Member[]>([])
  /** each connected person's audio */
  const remote = shallowRef<Record<string, MediaStream>>({})
  const linkStates = ref<Record<string, RTCPeerConnectionState>>({})

  const myId = computed(() => chat.myId)
  /** talking somewhere (a group call or announcing): blocks 1:1 calls */
  const talking = computed(() => phase.value !== 'idle' && role.value !== 'listener')
  const listening = computed(() => phase.value !== 'idle' && role.value === 'listener')
  const listeners = computed(() => members.value.filter((m) => m.role === 'listener').length)

  function callIn(channelId: string): ApiRoom | undefined {
    return Object.values(live.value).find((r) => r.kind === 'call' && r.channel_id === channelId)
  }
  function announcementIn(channelId: string | null): ApiRoom | undefined {
    return Object.values(live.value).find((r) => r.kind === 'announcement' && !r.target_user_id && r.channel_id === channelId)
  }
  const audienceName = (room: ApiRoom) => {
    if (room.target_user_id) return room.target_user_id === myId.value ? 'you' : chat.userName(room.target_user_id)
    if (!room.channel_id) return 'everyone'
    const ch = chat.channels.find((c) => c.id === room.channel_id)
    return ch ? chat.channelTitle(ch) : 'a channel'
  }

  let local: MediaStream | null = null
  let presence: PresenceChannel | null = null
  let presenceName: string | null = null
  let iceServers: RTCIceServer[] = []
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const links = new Map<string, Link>()

  // ---------------------------------------------------------------- what the API tells everyone

  /** Rooms already going when the app opened (or reconnected). */
  async function resume() {
    try {
      const res = await api<{ rooms: ApiRoom[] }>('/rooms/live')
      live.value = Object.fromEntries(res.rooms.map((r) => [r.id, r]))
    } catch {
      // banners are a nicety
    }
  }

  function onUpdated(room: ApiRoom) {
    const known = !!live.value[room.id]
    if (room.status === 'ended') {
      const { [room.id]: _gone, ...rest } = live.value
      live.value = rest
      if (current.value?.id === room.id) {
        const wasListening = role.value === 'listener'
        const name = chat.userName(room.started_by)
        cleanup()
        if (wasListening) toast.add({ title: room.target_user_id ? `${name} ended the intercom` : `${name} finished the announcement` })
      }
      return
    }
    live.value = { ...live.value, [room.id]: room }
    if (current.value?.id === room.id) current.value = { ...current.value, ...room, ice_servers: current.value.ice_servers }
    if (known || room.started_by === myId.value) return

    if (room.kind === 'call') {
      // a call started in a channel we are a member of: offer to join (no ringing; it is not addressed to us)
      const ch = chat.channels.find((c) => c.id === room.channel_id)
      if (!ch || !ch.member_ids.includes(myId.value ?? '') || busy()) return
      playNotes(TONES.bell.notes, 0.6)
      toast.add({
        title: `${chat.userName(room.started_by)} started a call in ${audienceName(room)}`,
        icon: 'i-lucide-phone',
        duration: 15_000,
        actions: [{ label: 'Join', icon: 'i-lucide-phone', onClick: () => void join(room.id) }],
      })
      return
    }
    // an announcement: it is heard straight away, unless we are on a call or on Do not disturb
    if (busy() || profile.profile?.status === 'dnd') return
    void listen(room)
  }

  const busy = () => calls.busy || phase.value !== 'idle'

  // ---------------------------------------------------------------- joining

  /** Start a group call in a project channel, or join the one going there. */
  async function startCall(channelId: string) {
    const going = callIn(channelId)
    if (going) return join(going.id)
    return enter('member', () => api<{ room: ApiRoom }>('/rooms', { method: 'POST', body: { kind: 'call', channel_id: channelId } }))
  }

  function join(roomId: string) {
    if (current.value?.id === roomId) return
    return enter('member', () => api<{ room: ApiRoom }>(`/rooms/${roomId}/join`, { method: 'POST' }))
  }

  /** Announce to a project channel, or (admins, null) to everyone online. */
  function announce(channelId: string | null) {
    return enter('speaker', () => api<{ room: ApiRoom }>('/rooms', { method: 'POST', body: { kind: 'announcement', channel_id: channelId } }))
  }

  /** Intercom (admins): your voice plays live for one person, without them answering. */
  async function intercom(userId: string) {
    await enter('speaker', () => api<{ room: ApiRoom }>('/rooms', { method: 'POST', body: { kind: 'announcement', target_user_id: userId } }))
    const room = current.value
    if (!room || room.target_user_id !== userId) return
    // they hear it only if their app is open; don't talk into the void
    setTimeout(() => {
      if (current.value?.id === room.id && listeners.value === 0) {
        void leave()
        toast.add({ title: `${chat.userName(userId)} didn't pick up the intercom`, description: 'They may be offline, on a call, or on Do not disturb.', color: 'warning' })
      }
    }, INTERCOM_PICKUP_MS)
  }

  function listen(room: ApiRoom) {
    return enter('listener', () => api<{ room: ApiRoom }>(`/rooms/${room.id}/join`, { method: 'POST' }), room)
  }

  async function enter(as: RoomRole, request: () => Promise<{ room: ApiRoom }>, announcement?: ApiRoom) {
    if (calls.busy) {
      if (as !== 'listener') toast.add({ title: 'You are already on a call' })
      return
    }
    if (phase.value !== 'idle') {
      if (role.value !== 'listener') {
        if (as !== 'listener') toast.add({ title: 'You are already on a call' })
        return
      }
      if (as === 'listener') return // already hearing one announcement
      await leave() // stop listening to talk
    }
    phase.value = 'joining'
    role.value = as

    if (as !== 'listener') {
      try {
        local = await requestMedia({ audio: CALL_AUDIO })
      } catch (e) {
        cleanup()
        toast.add({ title: 'Microphone unavailable', description: mediaErrorMessage(e, 'microphone'), color: 'error', duration: 12_000 })
        return
      }
      if (phase.value !== 'joining') return stopLocal() // cancelled meanwhile
    } else if (announcement) {
      playNotes(TONES.ding.notes) // intercom chime before the voice
    }

    let room: ApiRoom
    try {
      room = (await request()).room
    } catch (e) {
      cleanup()
      if (as !== 'listener') toast.add({ title: as === 'speaker' ? 'Announcement not started' : 'Could not join the call', description: errorMessage(e), color: 'error' })
      return
    }
    if (phase.value !== 'joining') { // left while the API answered
      void post(room, as === 'speaker' ? 'end' : 'leave')
      return
    }
    current.value = room
    live.value = { ...live.value, [room.id]: room }
    iceServers = room.ice_servers ?? []
    joinedAt.value = Date.now()
    phase.value = 'live'
    joinPresence(room)
    heartbeat = setInterval(() => void ping(), HEARTBEAT_MS)
    if (as === 'listener') {
      toast.add({
        title: room.target_user_id ? `${chat.userName(room.started_by)} is on the intercom` : `${chat.userName(room.started_by)} is announcing to ${audienceName(room)}`,
        icon: 'i-lucide-megaphone',
      })
    }
  }

  // ---------------------------------------------------------------- the mesh

  function me(): Member {
    return { id: myId.value ?? '', role: role.value ?? 'listener' }
  }

  function joinPresence(room: ApiRoom) {
    presenceName = `room.${room.id}`
    presence = (useEcho().join(presenceName) as unknown as PresenceChannel)
      .here((list) => {
        members.value = list.filter((m) => m.id !== myId.value).map((m) => ({ id: m.id, role: m.role }))
        for (const m of members.value) connect(m)
      })
      .joining((m) => {
        if (m.id === myId.value) return
        members.value = [...members.value.filter((x) => x.id !== m.id), { id: m.id, role: m.role }]
        drop(m.id) // came back (reload): start over
        connect({ id: m.id, role: m.role })
      })
      .leaving((m) => {
        members.value = members.value.filter((x) => x.id !== m.id)
        drop(m.id) // if it was the speaker, the API ends the announcement shortly (room.updated)
      })
      .listenForWhisper('signal', (e: RoomSignal<Signal>) => {
        if (e.to !== myId.value) return
        const link = links.get(e.from) ?? (e.signal.kind === 'offer' ? makeLink(e.from, false) : undefined)
        link?.peer.handle(e.signal).catch((err) => console.warn('[room] signal failed', err))
      })
      .error(() => {
        toast.add({ title: 'Could not join the room', color: 'error' })
        void leave()
      })
  }

  function connect(them: Member) {
    const { connect: needed, offer } = linkTo(me(), them)
    if (!needed || links.has(them.id)) return
    const link = makeLink(them.id, offer)
    if (offer) link.peer.offer().catch((e) => console.warn('[room] offer failed', e))
  }

  function makeLink(id: string, offer: boolean): Link {
    const peer = new CallPeer({
      iceServers,
      stream: local ?? new MediaStream(), // listeners send nothing
      caller: offer,
      send: (signal) => {
        try {
          presence?.whisper('signal', { from: myId.value ?? '', to: id, signal } satisfies RoomSignal<Signal>)
        } catch (e) {
          console.warn('[room] could not send', e)
        }
      },
      onRemoteStream: (s) => { remote.value = { ...remote.value, [id]: s } },
      onState: (state) => onLinkState(id, state),
    })
    peer.setMuted(muted.value)
    const link: Link = { peer, offer, restarted: false, timer: null }
    links.set(id, link)
    linkStates.value = { ...linkStates.value, [id]: 'new' }
    link.timer = setTimeout(() => giveUp(id), CONNECT_TIMEOUT_MS) // never connected
    return link
  }

  function onLinkState(id: string, state: RTCPeerConnectionState) {
    const link = links.get(id)
    if (!link) return
    linkStates.value = { ...linkStates.value, [id]: state }
    if (state === 'connected') {
      if (link.timer) clearTimeout(link.timer)
      link.timer = null
      return
    }
    if (state !== 'failed' && state !== 'disconnected') return
    if (state === 'failed' && link.offer && !link.restarted) { // one ICE restart per person
      link.restarted = true
      link.peer.offer(true).catch(() => {})
    }
    link.timer ??= setTimeout(() => giveUp(id), RECOVER_MS)
  }

  /** No audio path to this person. In a call they stay listed as unreachable; a listener stops listening. */
  function giveUp(id: string) {
    const link = links.get(id)
    if (!link) return
    link.timer = null
    if (link.peer.pc.connectionState === 'connected') return
    linkStates.value = { ...linkStates.value, [id]: 'failed' }
    if (role.value === 'listener') {
      toast.add({ title: "Couldn't hear the announcement", description: NETWORK_HINT, color: 'warning' })
      void leave()
    }
  }

  function drop(id: string) {
    const link = links.get(id)
    if (!link) return
    if (link.timer) clearTimeout(link.timer)
    link.peer.close()
    links.delete(id)
    const { [id]: _s, ...streams } = remote.value
    remote.value = streams
    const { [id]: _l, ...states } = linkStates.value
    linkStates.value = states
  }

  // ---------------------------------------------------------------- leaving

  async function ping() {
    const room = current.value
    if (!room) return
    try {
      const res = await api<{ room: ApiRoom }>(`/rooms/${room.id}/ping`, { method: 'POST' })
      if (res.room.status === 'ended') onUpdated(res.room)
    } catch {
      // offline for a moment
    }
  }

  function post(room: ApiRoom, action: 'leave' | 'end') {
    return api(`/rooms/${room.id}/${action}`, { method: 'POST' }).catch(() => {})
  }

  /** Leave the call, stop listening, or (speaker) end the announcement. */
  async function leave() {
    const room = current.value
    const wasSpeaker = role.value === 'speaker'
    cleanup()
    if (room) await post(room, wasSpeaker ? 'end' : 'leave')
  }

  function stopLocal() {
    for (const t of local?.getTracks() ?? []) t.stop()
    local = null
  }

  function cleanup() {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    for (const id of [...links.keys()]) drop(id)
    stopLocal()
    if (presenceName) {
      try {
        currentEcho()?.leave(presenceName)
      } catch {
        // socket already gone
      }
    }
    presence = null
    presenceName = null
    current.value = null
    role.value = null
    phase.value = 'idle'
    muted.value = false
    joinedAt.value = null
    members.value = []
    remote.value = {}
    linkStates.value = {}
    iceServers = []
  }

  function toggleMute() {
    muted.value = !muted.value
    for (const link of links.values()) link.peer.setMuted(muted.value)
    for (const t of local?.getAudioTracks() ?? []) t.enabled = !muted.value
  }

  /** Signed out. */
  function stop() {
    const room = current.value
    const wasSpeaker = role.value === 'speaker'
    cleanup()
    live.value = {}
    if (room && auth.token.value) void post(room, wasSpeaker ? 'end' : 'leave')
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      const room = current.value
      if (!room || !auth.token.value) return
      const base = `${String(config.public.apiUrl).replace(/\/$/, '')}/api`
      void fetch(`${base}/rooms/${room.id}/${role.value === 'speaker' ? 'end' : 'leave'}`, {
        method: 'POST',
        keepalive: true,
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token.value}` },
      }).catch(() => {})
    })
  }

  return {
    live, current, role, phase, muted, joinedAt, members, remote, linkStates, talking, listening, listeners,
    callIn, announcementIn, audienceName, resume, onUpdated, startCall, join, announce, intercom, leave, toggleMute, stop,
  }
})
