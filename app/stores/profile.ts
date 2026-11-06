import { defineStore } from 'pinia'
import type { UserStatus } from '~/utils/status'

export interface Profile {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  app_role: 'super_admin' | 'admin' | 'member' | 'viewer'
  status: UserStatus
}

export const useProfileStore = defineStore('profile', () => {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const profile = ref<Profile | null>(null)

  const isSuperAdmin = computed(() => profile.value?.app_role === 'super_admin')
  const isAdmin = computed(() => profile.value?.app_role === 'super_admin' || profile.value?.app_role === 'admin')
  /** Viewers can read what they were added to and send direct messages, nothing else. */
  const isViewer = computed(() => profile.value?.app_role === 'viewer')

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

  return { profile, isAdmin, isSuperAdmin, isViewer, load, setStatus }
})
