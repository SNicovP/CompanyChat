import { defineStore } from 'pinia'
import type { Database } from '~/types/database.types'

type Tables = Database['public']['Tables']
export type Client = Pick<Tables['clients']['Row'], 'id' | 'name'>
export type DirectoryUser = Pick<Tables['profiles']['Row'], 'id' | 'display_name' | 'status' | 'app_role'>
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
      supabase.from('profiles').select('id, display_name, status, app_role').order('display_name'),
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
    clients.value = []
    channels.value = []
    directory.value = {}
    managedClientIds.value = []
    managedChannelIds.value = []
    loaded.value = false
  }

  return { clients, channels, directory, managedClientIds, managedChannelIds, canManageClient, canManageChannel, loaded, myId, projectsByClient, dms, otherUser, channelTitle, userName, load, createClient, createProject, startDm, reset }
})
