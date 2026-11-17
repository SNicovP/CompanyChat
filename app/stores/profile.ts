import { defineStore } from 'pinia'
import type { ApiUser, AppRole } from '~/types/api'
import type { UserStatus } from '~/utils/status'
import { reconcileTones, type Tones } from '~/utils/tones'

export interface Profile {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  app_role: AppRole
  status: UserStatus
}

export const useProfileStore = defineStore('profile', () => {
  const api = useApi()
  const auth = useAuth()
  const profile = ref<Profile | null>(null)
  const notifier = useNotifier()
  const customSounds = useCustomSounds()

  const isSuperAdmin = computed(() => profile.value?.app_role === 'super_admin')
  const isAdmin = computed(() => profile.value?.app_role === 'super_admin' || profile.value?.app_role === 'admin')
  /** Viewers can read what they were added to and send direct messages, nothing else. */
  const isViewer = computed(() => profile.value?.app_role === 'viewer')

  async function load() {
    if (!auth.signedIn.value) {
      profile.value = null
      return
    }
    const me = await api<ApiUser>('/me')
    auth.user.value = me
    profile.value = { ...me, email: me.email ?? '' }
    adoptTones(me)
    customSounds.load(me.id).catch(() => {}) // uploaded tones: until they arrive, the defaults play
  }

  // --- notification tones: saved to the account so they survive clearing site data and follow you to other devices
  function adoptTones(me: ApiUser) {
    const { tones, upload } = reconcileTones({
      account: me.notification_tones,
      local: notifier.prefs.value.tones,
      localOwner: notifier.prefs.value.tonesOwner,
      me: me.id,
    })
    notifier.set('tones', tones)
    notifier.set('tonesOwner', me.id)
    if (upload) saveTones(tones).catch(() => {}) // a choice made on this device before accounts kept them
  }

  // One save at a time, in order, so quick changes can't land out of order.
  let saving: Promise<unknown> = Promise.resolve()

  /** Save tones to the account (null = back to the defaults). This device already uses them. */
  function saveTones(tones: Tones | null): Promise<void> {
    const run = saving.catch(() => {}).then(() => api('/me', { method: 'PATCH', body: { notification_tones: tones } }))
    saving = run
    return run.then(() => {})
  }

  async function setStatus(status: UserStatus) {
    if (!profile.value) return
    const previous = profile.value.status
    profile.value.status = status
    try {
      await api('/me', { method: 'PATCH', body: { status } })
    } catch (e) {
      profile.value.status = previous
      throw e
    }
  }

  return { profile, isAdmin, isSuperAdmin, isViewer, load, setStatus, saveTones }
})
