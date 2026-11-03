import { defineStore } from 'pinia'
import type { UserStatus } from '~/utils/status'

export interface Profile {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  app_role: 'owner' | 'admin' | 'member'
  status: UserStatus
}

export const useProfileStore = defineStore('profile', () => {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const profile = ref<Profile | null>(null)

  const isAdmin = computed(() => profile.value?.app_role === 'owner' || profile.value?.app_role === 'admin')

  async function load() {
    const id = user.value?.id ?? user.value?.sub
    if (!id) {
      profile.value = null
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
    if (error) throw error
    profile.value = data as Profile
  }

  async function setStatus(status: UserStatus) {
    if (!profile.value) return
    const previous = profile.value.status
    profile.value.status = status
    const { error } = await supabase.from('profiles').update({ status }).eq('id', profile.value.id)
    if (error) {
      profile.value.status = previous
      throw error
    }
  }

  return { profile, isAdmin, load, setStatus }
})
