import { defineStore } from 'pinia'
import type { ApiCall } from '~/types/api'
import { CALL_AUDIO, CallPeer, NETWORK_HINT, endedNotice, webrtcSupported, type Signal } from '~/utils/peer'
import { mediaErrorMessage, requestMedia } from '~/utils/recording'
import { RINGBACK, RINGTONE, RING_REPEAT_MS, playNotes, type Note } from '~/utils/tones'

/**
 * 1:1 voice calls. The API rings the other person and keeps the call's state (private-user.{id}: call.invited,
 * call.updated); the two apps then connect the audio with WebRTC, passing the set-up through whispers on
 * private-call.{id}:
 *
 *   caller                                   callee
 *   POST /calls, join call channel  ──ring──▶ incoming (modal)
 *                                            POST accept, join, whisper "ready" (repeated until the offer comes)
 *   on "ready": offer            ──signal──▶ answer
 *   ICE candidates               ◀─signal──▶ ICE candidates
 *   connected: audio flows directly between the devices; both ping the API every 30 s
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'reconnecting'

/** Give up on connecting after this long (no route between the two networks without a TURN relay). */
const CONNECT_TIMEOUT_MS = 25_000
/** After the connection broke, how long to wait for it to recover. */
const RECOVER_MS = 12_000
const READY_REPEAT_MS = 2_000
const HEARTBEAT_MS = 30_000
const RING_TIMEOUT_MS = 46_000

type EchoChannel = {
  listen: (event: string, cb: (e: never) => void) => EchoChannel
  listenForWhisper: (event: string, cb: (e: never) => void) => EchoChannel
  whisper: (event: string, data: unknown) => EchoChannel
  subscribed: (cb: () => void) => EchoChannel
  error: (cb: (e: unknown) => void) => EchoChannel
}

export const useCallStore = defineStore('call', () => {
  const chat = useChatStore()
  const toast = useToast()
  const api = useApi()
  const auth = useAuth()
  const config = useRuntimeConfig()

  const call = ref<ApiCall | null>(null)
  const phase = ref<CallPhase>('idle')
  const muted = ref(false)
  /** when the audio first connected (local clock, for the timer) */
  const connectedAt = ref<number | null>(null)
  const remoteStream = shallowRef<MediaStream | null>(null)
  /** who we are calling, before the API has answered with the call */
  const dialing = ref<string | null>(null)

  const busy = computed(() => phase.value !== 'idle')
  const isCaller = computed(() => !!call.value && call.value.caller_id === chat.myId)
  const peerId = computed(() => {
    if (!call.value) return dialing.value
    return call.value.caller_id === chat.myId ? call.value.callee_id : call.value.caller_id
  })
  const peerName = computed(() => (peerId.value ? chat.userName(peerId.value) : ''))

  let local: MediaStream | null = null
  let peer: CallPeer | null = null
  let channel: EchoChannel | null = null
  let channelName: string | null = null
  let iceServers: RTCIceServer[] = []
  let restarted = false
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function setTimer(name: string, fn: () => void, ms: number, repeat = false) {
    clearTimer(name)
    timers.set(name, repeat ? setInterval(fn, ms) : setTimeout(fn, ms))
  }
  function clearTimer(name: string) {
    const t = timers.get(name)
    if (t !== undefined) {
      clearTimeout(t)
      clearInterval(t)
      timers.delete(name)
    }
  }

  function ring(notes: Note[] | null) {
    clearTimer('ring')
    if (!notes) return
    playNotes(notes)
    setTimer('ring', () => playNotes(notes), RING_REPEAT_MS, true)
  }

  async function microphone(): Promise<MediaStream | null> {
    try {
      return await requestMedia({ audio: CALL_AUDIO })
    } catch (e) {
      console.warn('[call] microphone', e)
      toast.add({ title: 'Microphone unavailable', description: mediaErrorMessage(e, 'microphone'), color: 'error', duration: 12_000 })
      return null
    }
  }

  /** Tear everything down on this device (does not tell the API). */
  function cleanup() {
    for (const name of [...timers.keys()]) clearTimer(name)
    peer?.close()
    peer = null
    for (const t of local?.getTracks() ?? []) t.stop()
    local = null
    if (channelName) {
      try {
        currentEcho()?.leave(channelName)
      } catch {
        // socket already gone
      }
    }
    channel = null
    channelName = null
    remoteStream.value = null
    call.value = null
    dialing.value = null
    phase.value = 'idle'
    muted.value = false
    connectedAt.value = null
    restarted = false
    iceServers = []
  }

  function connectedSeconds() {
    return connectedAt.value === null ? null : Math.round((Date.now() - connectedAt.value) / 1000)
  }

  // ---------------------------------------------------------------- signalling

  function joinCallChannel(id: string) {
    channelName = `call.${id}`
    channel = (useEcho().private(channelName) as unknown as EchoChannel)
      .listenForWhisper('ready', () => onReady())
      .listenForWhisper('signal', (s: Signal) => {
        peer?.handle(s).catch((e) => console.warn('[call] signal failed', e))
      })
  }

  function send(signal: Signal) {
    try {
      channel?.whisper('signal', signal)
    } catch (e) {
      console.warn('[call] could not send', e)
    }
  }

  function makePeer(caller: boolean) {
    peer = new CallPeer({
      iceServers,
      stream: local!,
      caller,
      send,
      onRemoteStream: (s) => { remoteStream.value = s },
      onState: onPeerState,
    })
    peer.setMuted(muted.value)
  }

  /** Caller: the callee has joined the call channel, so the offer will reach them. */
  function onReady() {
    if (!isCaller.value || peer || !local || !call.value) return
    makePeer(true)
    peer!.offer().catch((e) => console.warn('[call] offer failed', e))
  }

  function waitForConnection() {
    if (phase.value !== 'reconnecting') phase.value = 'connecting'
    setTimer('connect', () => {
      if (phase.value === 'connecting') void hangup('failed')
    }, CONNECT_TIMEOUT_MS)
  }

  function onPeerState(state: RTCPeerConnectionState) {
    if (state === 'connected') {
      clearTimer('connect')
      clearTimer('recover')
      clearTimer('ready')
      phase.value = 'active'
      connectedAt.value ??= Date.now()
      if (!timers.has('heartbeat')) setTimer('heartbeat', () => void heartbeat(), HEARTBEAT_MS, true)
      return
    }
    if (state === 'disconnected' || state === 'failed') {
      if (phase.value === 'active') phase.value = 'reconnecting'
      // The caller tries one ICE restart; both sides give up if it does not come back.
      if (state === 'failed' && isCaller.value && !restarted) {
        restarted = true
        peer?.offer(true).catch(() => {})
      }
      if (!timers.has('recover')) {
        setTimer('recover', () => {
          if (peer?.pc.connectionState !== 'connected') void hangup('failed')
        }, RECOVER_MS)
      }
    }
  }

  async function heartbeat() {
    const c = call.value
    if (!c) return
    try {
      const res = await api<{ call: ApiCall }>(`/calls/${c.id}/ping`, { method: 'POST' })
      if (call.value?.id === c.id && res.call.status !== 'active') onUpdated(res.call)
    } catch {
      // offline for a moment: WebRTC tells us if the call itself dropped
    }
  }

  // ---------------------------------------------------------------- events from the API

  /** Wire up call.invited / call.updated on our private-user channel (called by the chat store on start). */
  function listen(userChannel: unknown) {
    ;(userChannel as EchoChannel)
      .listen('.call.invited', (e: { call: ApiCall }) => onInvited(e.call))
      .listen('.call.updated', (e: { call: ApiCall }) => onUpdated(e.call))
    void resume()
  }

  /** The app (re)opened while someone is calling us: ring. */
  async function resume() {
    try {
      const res = await api<{ call: ApiCall | null }>('/calls/current')
      if (res.call?.status === 'ringing') onInvited(res.call)
    } catch {
      // not important enough to complain about
    }
  }

  function onInvited(c: ApiCall) {
    if (c.callee_id !== chat.myId) return
    if (busy.value) return // on a call on this device; the API only lets the call through if we are not "busy"
    call.value = c
    phase.value = 'incoming'
    ring(RINGTONE)
    const left = RING_TIMEOUT_MS - (Date.now() - new Date(c.created_at).getTime())
    setTimer('incoming', () => {
      if (phase.value === 'incoming' && call.value?.id === c.id) cleanup() // the API sends "missed" too; don't hang on to a dead ring
    }, Math.max(1000, Math.min(left, RING_TIMEOUT_MS)))
  }

  function onUpdated(c: ApiCall) {
    if (!call.value || c.id !== call.value.id) return
    if (c.status === 'active') {
      if (phase.value === 'incoming') {
        cleanup() // answered on another of our devices
        return
      }
      if (phase.value === 'outgoing') {
        call.value = { ...call.value, ...c }
        ring(null)
        waitForConnection()
      }
      return
    }
    if (c.status === 'ringing') return
    // ended by the other side, the server (no answer, lost), or on another of our devices
    const notice = endedNotice(c, { iAmCaller: c.caller_id === chat.myId, name: peerName.value, connectedSeconds: connectedSeconds() })
    cleanup()
    if (notice) toast.add(notice)
  }

  // ---------------------------------------------------------------- actions

  /** Call the other person in a DM. */
  async function start(channelId: string) {
    if (busy.value) {
      toast.add({ title: 'You are already on a call' })
      return
    }
    if (!webrtcSupported()) {
      toast.add({ title: 'Calls are not supported here', description: 'This browser cannot make voice calls.', color: 'error' })
      return
    }
    const target = chat.channels.find((c) => c.id === channelId)
    dialing.value = target ? chat.otherUser(target)?.id ?? null : null
    phase.value = 'outgoing'

    const mic = await microphone()
    if (!mic) {
      cleanup()
      return
    }
    if (phase.value !== 'outgoing') { // hung up while the browser asked for the microphone
      for (const t of mic.getTracks()) t.stop()
      return
    }
    local = mic

    let created: ApiCall
    try {
      created = (await api<{ call: ApiCall }>('/calls', { method: 'POST', body: { channel_id: channelId } })).call
    } catch (e) {
      cleanup()
      toast.add({ title: 'Call not started', description: errorMessage(e), color: 'error' })
      return
    }
    if (phase.value !== 'outgoing') { // hung up while the API was ringing them
      void api(`/calls/${created.id}/end`, { method: 'POST' }).catch(() => {})
      return
    }
    call.value = created
    iceServers = created.ice_servers ?? []
    joinCallChannel(created.id)
    ring(RINGBACK)
  }

  async function accept() {
    const c = call.value
    if (phase.value !== 'incoming' || !c) return
    ring(null)
    clearTimer('incoming')
    phase.value = 'connecting'

    const mic = await microphone()
    if (!mic) {
      await decline()
      return
    }
    local = mic
    try {
      const res = await api<{ call: ApiCall }>(`/calls/${c.id}/accept`, { method: 'POST' })
      call.value = res.call
      iceServers = res.call.ice_servers ?? []
    } catch (e) {
      cleanup()
      toast.add({ title: 'Could not answer', description: errorMessage(e), color: 'warning' })
      return
    }

    makePeer(false)
    joinCallChannel(c.id)
    // Tell the caller we are listening; repeated in case the first whisper races their subscription.
    const ready = () => {
      if (peer?.pc.remoteDescription) clearTimer('ready')
      else channel?.whisper('ready', {})
    }
    channel!.subscribed(() => {
      ready()
      setTimer('ready', ready, READY_REPEAT_MS, true)
    }).error(() => void hangup('failed'))
    waitForConnection()
  }

  async function decline() {
    const c = call.value
    cleanup()
    if (c) await api(`/calls/${c.id}/reject`, { method: 'POST' }).catch(() => {})
  }

  /** Hang up (or cancel an outgoing call). `failed`: the devices could not connect. */
  async function hangup(reason: 'hangup' | 'failed' = 'hangup') {
    const c = call.value
    const wasConnected = connectedSeconds() !== null
    cleanup()
    if (reason === 'failed') {
      toast.add(wasConnected
        ? { title: 'Call dropped', description: 'The connection was lost.', color: 'warning' }
        : { title: "Couldn't connect the call", description: NETWORK_HINT, color: 'error' })
    }
    if (c) await api(`/calls/${c.id}/end`, { method: 'POST', body: { reason } }).catch(() => {})
  }

  function toggleMute() {
    muted.value = !muted.value
    peer?.setMuted(muted.value)
    for (const t of local?.getAudioTracks() ?? []) t.enabled = !muted.value
  }

  /** Signed out: drop any call without ceremony. */
  function stop() {
    const c = call.value
    cleanup()
    if (c && auth.token.value) void api(`/calls/${c.id}/end`, { method: 'POST' }).catch(() => {})
  }

  // Closing or reloading the tab mid-call: hang up so the other side is not left waiting for a dead connection.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      const c = call.value
      if (!c || !auth.token.value) return
      const base = `${String(config.public.apiUrl).replace(/\/$/, '')}/api`
      void fetch(`${base}/calls/${c.id}/${phase.value === 'incoming' ? 'reject' : 'end'}`, {
        method: 'POST',
        keepalive: true,
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token.value}` },
      }).catch(() => {})
    })
  }

  return { call, phase, muted, connectedAt, remoteStream, busy, isCaller, peerId, peerName, listen, start, accept, decline, hangup, toggleMute, stop }
})
