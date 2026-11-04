import { defineStore } from 'pinia'
import type { Database } from '~/types/database.types'
import { effectiveStatus, type DisplayStatus } from '~/utils/status'

type Tables = Database['public']['Tables']
export type Client = Pick<Tables['clients']['Row'], 'id' | 'name'>
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
  const directory = ref<Record<string, DirectoryUser>>({})
  const managedClientIds = ref<string[]>([])
  const managedChannelIds = ref<string[]>([])
  const onlineIds = ref<string[]>([])
  const unread = ref<Record<string, number>>({})
  const activeChannelId = ref<string | null>(null)
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

  // UI hints only: RLS is what actually enforces these.
  const canManageClient = (clientId: string) => profileStore.isAdmin || managedClientIds.value.includes(clientId)
  const canManageChannel = (channel: Channel | undefined) =>
    !!channel && channel.kind === 'project' && (
      (channel.client_id !== null && canManageClient(channel.client_id)) || managedChannelIds.value.includes(channel.id)
    )

  async function load() {
    const [c, ch, p, mine, mineCh] = await Promise.all([
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('channels').select('id, kind, client_id, name, is_private, channel_members(user_id)'),
      supabase.from('profiles').select('id, display_name, status, app_role, is_active').order('display_name'),
      supabase.from('client_members').select('client_id').eq('role', 'manager').eq('user_id', myId.value ?? ''),
      supabase.from('channel_members').select('channel_id').eq('role', 'manager').eq('user_id', myId.value ?? ''),
    ])
    if (c.error) throw c.error
    if (ch.error) throw ch.error
    if (p.error) throw p.error
    if (mine.error) throw mine.error
    if (mineCh.error) throw mineCh.error
    clients.value = c.data
    channels.value = ch.data.map((row) => ({
      id: row.id,
      kind: row.kind,
      client_id: row.client_id,
      name: row.name,
      is_private: row.is_private,
      member_ids: row.channel_members.map((m) => m.user_id),
    }))
    managedClientIds.value = mine.data.map((m) => m.client_id)
    managedChannelIds.value = mineCh.data.map((m) => m.channel_id)
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
  }

  async function markRead(channelId: string) {
    if (unread.value[channelId]) unread.value = { ...unread.value, [channelId]: 0 }
    await supabase.rpc('mark_channel_read', { chid: channelId })
  }

  function setActive(channelId: string | null) {
    activeChannelId.value = channelId
    if (channelId) markRead(channelId)
  }

  async function onIncomingMessage(m: { channel_id: string; user_id: string | null }) {
    if (m.user_id === myId.value) return
    if (!channels.value.some((c) => c.id === m.channel_id)) {
      await load() // e.g. someone just started a DM with us
      return
    }
    if (m.channel_id === activeChannelId.value && viewing()) markRead(m.channel_id)
    else unread.value = { ...unread.value, [m.channel_id]: (unread.value[m.channel_id] ?? 0) + 1 }
  }

  // --- live presence and profile updates -------------------------------------------------
  let started: string | null = null
  let presenceChannel: ReturnType<typeof supabase.channel> | null = null
  let profileChannel: ReturnType<typeof supabase.channel> | null = null
  let messageChannel: ReturnType<typeof supabase.channel> | null = null
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
        onIncomingMessage(payload.new as { channel_id: string; user_id: string | null })
      })
      .subscribe()
    window.addEventListener('focus', onFocus)
  }

  function stop() {
    if (messageChannel) supabase.removeChannel(messageChannel)
    messageChannel = null
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    if (presenceChannel) supabase.removeChannel(presenceChannel)
    if (profileChannel) supabase.removeChannel(profileChannel)
    presenceChannel = profileChannel = null
    started = null
    onlineIds.value = []
    unread.value = {}
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
    directory.value = {}
    managedClientIds.value = []
    managedChannelIds.value = []
    loaded.value = false
  }

  return { clients, channels, directory, onlineIds, activePeople, displayStatus, start, stop, unread, totalUnread, activeChannelId, setActive, markRead, managedClientIds, managedChannelIds, canManageClient, canManageChannel, loaded, myId, projectsByClient, dms, otherUser, channelTitle, userName, load, createClient, createProject, startDm, reset }
})
