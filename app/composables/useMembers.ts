import type { Database } from '~/types/database.types'

export type MemberKind = 'client' | 'channel'
export type MembershipRole = Database['public']['Enums']['membership_role']
export interface Member {
  user_id: string
  role: MembershipRole
}

/** Read and edit the members of a client or a project channel. RLS decides who may change what. */
export function useMembers(kind: MemberKind, id: Ref<string>) {
  const supabase = useSupabaseClient<Database>()
  const members = ref<Member[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const query =
      kind === 'client'
        ? supabase.from('client_members').select('user_id, role').eq('client_id', id.value)
        : supabase.from('channel_members').select('user_id, role').eq('channel_id', id.value)
    const { data, error } = await query
    loading.value = false
    if (error) throw error
    members.value = data
  }

  async function add(userId: string) {
    const { error } =
      kind === 'client'
        ? await supabase.from('client_members').insert({ client_id: id.value, user_id: userId })
        : await supabase.from('channel_members').insert({ channel_id: id.value, user_id: userId })
    if (error) throw error
    await load()
  }

  async function setRole(userId: string, role: MembershipRole) {
    const { error } =
      kind === 'client'
        ? await supabase.from('client_members').update({ role }).eq('client_id', id.value).eq('user_id', userId)
        : await supabase.from('channel_members').update({ role }).eq('channel_id', id.value).eq('user_id', userId)
    if (error) throw error
    await load()
  }

  async function remove(userId: string) {
    const { error } =
      kind === 'client'
        ? await supabase.from('client_members').delete().eq('client_id', id.value).eq('user_id', userId)
        : await supabase.from('channel_members').delete().eq('channel_id', id.value).eq('user_id', userId)
    if (error) throw error
    await load()
  }

  return { members, loading, load, add, setRole, remove }
}
