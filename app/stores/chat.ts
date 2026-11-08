import { defineStore } from 'pinia'
import type { Database } from '~/types/database.types'
import { effectiveStatus, type DisplayStatus } from '~/utils/status'

type Tables = Database['public']['Tables']
export type Client = Pick<Tables['clients']['Row'], 'id' | 'name'>
export interface ArchivedProject { id: string; name: string | null; client_id: string; clientName: string }
export type DirectoryUser = Pick<Tables['profiles']['Row'], 'id' | 'display_name' | 'status' | 'app_role' | 'is_active'>
export interface Channel {
  id: string
  kind: 'project' | 'dm'
  client_id: string | null
  name: string | null
  is_private: boolean
  member_ids: string[]
}

export const useChatStore = defineStore('chat', () => {
  const supabase = useSupabaseClient<Database>()
  const me = useSupabaseUser()

  const clients = ref<Client[]>([])
  const channels = ref<Channel[]>([])
  /** Archived clients and projects that I may restore (admins). Hidden everywhere else. */
  const archivedClients = ref<Client[]>([])
  const archivedProjects = ref<ArchivedProject[]>([])
  const directory = ref<Record<string, DirectoryUser>>({})
  const onlineIds = ref<string[]>([])
  const unread = ref<Record<string, number>>({})
  const mentions = ref<Record<string, number>>({})
  const activeChannelId = ref<string | null>(null)
  const watchedChannelIds = ref<string[]>([])
  const loaded = ref(false)

  const myId = computed(() => me.value?.id ?? me.value?.sub ?? null)

  const projectsByClient = computed(() => {
    const map: Record<string, Channel[]> = {}
    for (const c of channels.value) {
      if (c.kind === 'project' && c.client_id) (map[c.client_id] ||= []).push(c)
    }
    for (const list of Object.values(map)) list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return map
  })

  const totalMentions = computed(() => Object.values(mentions.value).reduce((a, b) => a + b, 0))
  const totalUnread = computed(() => Object.values(unread.value).reduce((a, b) => a + b, 0))

  const activePeople = computed(() => Object.values(directory.value).filter((u) => u.is_active))

  const dms = computed(() => channels.value.filter((c) => c.kind === 'dm'))

  function otherUser(channel: Channel): DirectoryUser | undefined {
    const otherId = channel.member_ids.find((id) => id !== myId.value)
    return otherId ? directory.value[otherId] : undefined
  }

  function channelTitle(channel: Channel) {
    return channel.kind === 'dm' ? (otherUser(channel)?.display_name ?? 'Direct message') : `# ${channel.name}`
  }

  function userName(id: string | null) {
    return (id && directory.value[id]?.display_name) || 'Unknown'
  }

  const profileStore = useProfileStore()
  const notifier = useNotifier()
  const push = usePush()

  // UI hints only: RLS is what actually enforces these.
  const canManageClient = (_clientId?: string) => profileStore.isAdmin
  const canManageChannel = (channel: Channel | undefined) => !!channel && channel.kind === 'project' && profileStore.isAdmin

  async function load() {
    const [c, ch, p, watches] = await Promise.all([
      supabase.from('clients').select('id, name, archived_at').order('name'),
      supabase.from('channels').select('id, kind, client_id, name, is_private, archived_at, channel_members(user_id)'),
      supabase.from('profiles').select('id, display_name, status, app_role, is_active').order('display_name'),
      supabase.from('channel_watches').select('channel_id'),
    ])
    if (c.error) throw c.error
    if (ch.error) throw ch.error
    if (p.error) throw p.error
    if (watches.error) throw watches.error
    const archivedClientIds = new Set(c.data.filter((x) => x.archived_at).map((x) => x.id))
    clients.value = c.data.filter((x) => !x.archived_at).map(({ id, name }) => ({ id, name }))
    archivedClients.value = c.data.filter((x) => x.archived_at).map(({ id, name }) => ({ id, name }))
    const clientNames = Object.fromEntries(c.data.map((x) => [x.id, x.name]))
    // A project is archived on its own, or because its client is (the latter is restored with the client).
    archivedProjects.value = ch.data
      .filter((row) => row.kind === 'project' && row.archived_at && row.client_id && !archivedClientIds.has(row.client_id))
      .map((row) => ({ id: row.id, name: row.name, client_id: row.client_id!, clientName: clientNames[row.client_id!] ?? '' }))
    channels.value = ch.data.filter((row) => !row.archived_at && !(row.client_id && archivedClientIds.has(row.client_id))).map((row) => ({
      id: row.id,
      kind: row.kind,
      client_id: row.client_id,
      name: row.name,
      is_private: row.is_private,
      member_ids: row.channel_members.map((m) => m.user_id),
    }))
    watchedChannelIds.value = watches.data.map((w) => w.channel_id)
    directory.value = Object.fromEntries(p.data.map((u) => [u.id, u]))
    loaded.value = true
    await loadUnread()
  }

  function displayStatus(userId: string | null | undefined): DisplayStatus {
    if (!userId) return 'offline'
    return effectiveStatus(directory.value[userId]?.status, onlineIds.value.includes(userId))
  }

  // --- unread counts ---------------------------------------------------------------------
  const viewing = () => typeof document !== 'undefined' && document.hasFocus()

  async function loadUnread() {
    const { data, error } = await supabase.rpc('get_unread_counts')
    if (error) return // counts are a nicety; never block the app on them
    const counts = Object.fromEntries(data.map((r) => [r.chan_id, Number(r.unread)]))
    if (activeChannelId.value && viewing()) delete counts[activeChannelId.value]
    unread.value = counts

    const { data: mentionData, error: mentionError } = await supabase.rpc('get_unread_mention_counts')
    if (mentionError) return
    const mentionCounts = Object.fromEntries(mentionData.map((r) => [r.chan_id, Number(r.mentions)]))
    if (activeChannelId.value && viewing()) delete mentionCounts[activeChannelId.value]
    mentions.value = mentionCounts
  }

  async function markRead(channelId: string) {
    if (unread.value[channelId]) unread.value = { ...unread.value, [channelId]: 0 }
    if (mentions.value[channelId]) mentions.value = { ...mentions.value, [channelId]: 0 }
    await supabase.rpc('mark_channel_read', { chid: channelId })
  }

  function setActive(channelId: string | null) {
    activeChannelId.value = channelId
    if (channelId) markRead(channelId)
  }

  async function onIncomingMessage(m: { channel_id: string; user_id: string | null; body?: string }) {
    if (m.user_id === myId.value) return
    if (!channels.value.some((c) => c.id === m.channel_id)) {
      await load() // e.g. someone just started a DM with us
      return
    }
    if (m.channel_id === activeChannelId.value && viewing()) markRead(m.channel_id)
    else unread.value = { ...unread.value, [m.channel_id]: (unread.value[m.channel_id] ?? 0) + 1 }
    notifyAbout(m as { channel_id: string; user_id: string | null; body: string })
  }

  function notifyAbout(m: { channel_id: string; user_id: string | null; body: string }) {
    console.debug('[notify] message received in realtime')
    const channel = channels.value.find((c) => c.id === m.channel_id)
    if (!channel) return
    const body = m.body ?? ''
    const mentionsMe = mentionsUser(body, myId.value)
    const decision = notifyDecision({
      fromSelf: m.user_id === myId.value,
      windowFocused: viewing(),
      status: profileStore.profile?.status,
      kind: channel.kind,
      mentionsMe,
      watching: watchedChannelIds.value.includes(channel.id),
    })
    console.debug('[notify]', decision.notify ? 'showing' : 'skipped', '-', decision.reason)
    if (!decision.notify) return
    if (push.active.value) {
      // The service worker shows the notification (also when this tab is open but not focused); don't double up.
      notifier.chime()
      return
    }
    const text = notificationText({
      kind: channel.kind,
      senderName: userName(m.user_id),
      channelName: channel.name,
      body,
      nameOf: userName,
    })
    void notifier.show({ channelId: channel.id, ...text }).then((problem) => {
      if (problem) console.debug('[notify] not shown:', problem)
    })
  }

  async function setWatching(channelId: string, on: boolean) {
    if (on) {
      const { error } = await supabase.from('channel_watches').insert({ channel_id: channelId })
      if (error) throw error
      watchedChannelIds.value = [...watchedChannelIds.value, channelId]
    } else {
      const { error } = await supabase.from('channel_watches').delete().eq('channel_id', channelId)
      if (error) throw error
      watchedChannelIds.value = watchedChannelIds.value.filter((id) => id !== channelId)
    }
  }

  // --- live presence and profile updates -------------------------------------------------
  let started: string | null = null
  let presenceChannel: ReturnType<typeof supabase.channel> | null = null
  let profileChannel: ReturnType<typeof supabase.channel> | null = null
  let messageChannel: ReturnType<typeof supabase.channel> | null = null
  let mentionChannel: ReturnType<typeof supabase.channel> | null = null
  const onFocus = () => { if (activeChannelId.value) markRead(activeChannelId.value) }

  /** Idempotent per signed-in user (the auth user object can re-emit on token refresh). */
  function start() {
    const id = myId.value
    if (!id || started === id) return
    stop()
    started = id

    presenceChannel = supabase.channel('office-presence', { config: { presence: { key: id } } })
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        onlineIds.value = Object.keys(presenceChannel?.presenceState() ?? {})
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await presenceChannel?.track({ online_at: new Date().toISOString() })
      })

    profileChannel = supabase
      .channel('profiles-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        const row = payload.new as Partial<DirectoryUser> & { id?: string }
        if (row?.id && row.display_name !== undefined) {
          directory.value = {
            ...directory.value,
            [row.id]: { id: row.id, display_name: row.display_name, status: row.status!, app_role: row.app_role!, is_active: row.is_active ?? true },
          }
        }
      })
      .subscribe()

    // RLS filters these events, so we only hear about channels we can access.
    messageChannel = supabase
      .channel('messages-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        onIncomingMessage(payload.new as { channel_id: string; user_id: string | null; body?: string })
      })
      .subscribe()

    // Only our own mentions are delivered (RLS), so no filter is needed beyond being explicit.
    mentionChannel = supabase
      .channel('mentions-me')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_mentions', filter: `user_id=eq.${id}` }, (payload) => {
        const channelId = (payload.new as { channel_id: string }).channel_id
        if (channelId === activeChannelId.value && viewing()) return // already being read
        mentions.value = { ...mentions.value, [channelId]: (mentions.value[channelId] ?? 0) + 1 }
      })
      .subscribe()
    window.addEventListener('focus', onFocus)
  }

  function stop() {
    if (messageChannel) supabase.removeChannel(messageChannel)
    messageChannel = null
    if (mentionChannel) supabase.removeChannel(mentionChannel)
    mentionChannel = null
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    if (presenceChannel) supabase.removeChannel(presenceChannel)
    if (profileChannel) supabase.removeChannel(profileChannel)
    presenceChannel = profileChannel = null
    started = null
    onlineIds.value = []
    unread.value = {}
    mentions.value = {}
  }

  async function createClient(name: string) {
    const { error } = await supabase.from('clients').insert({ name: name.trim() })
    if (error) throw error
    await load()
  }

  async function createProject(clientId: string, name: string, isPrivate: boolean) {
    const { data, error } = await supabase
      .from('channels')
      .insert({ kind: 'project', client_id: clientId, name: name.trim(), is_private: isPrivate })
      .select('id')
      .single()
    if (error) throw error
    await load()
    return data.id
  }

  async function setProjectArchived(channelId: string, archived: boolean) {
    const { error } = await supabase.rpc('set_channel_archived', { chid: channelId, archived })
    if (error) throw error
    await load()
  }

  async function setClientArchived(clientId: string, archived: boolean) {
    const { error } = await supabase.rpc('set_client_archived', { cid: clientId, archived })
    if (error) throw error
    await load()
  }

  async function startDm(userId: string) {
    const { data, error } = await supabase.rpc('get_or_create_dm', { other_user: userId })
    if (error) throw error
    await load()
    return data
  }

  function reset() {
    stop()
    clients.value = []
    channels.value = []
    archivedClients.value = []
    archivedProjects.value = []
    directory.value = {}
    watchedChannelIds.value = []
    loaded.value = false
  }

  return { clients, channels, directory, onlineIds, activePeople, displayStatus, start, stop, watchedChannelIds, setWatching, unread, mentions, totalUnread, totalMentions, activeChannelId, setActive, markRead, canManageClient, canManageChannel, loaded, myId, projectsByClient, dms, otherUser, channelTitle, userName, load, createClient, createProject, setProjectArchived, setClientArchived, archivedClients, archivedProjects, startDm, reset }
})
