<script setup lang="ts">
import { STATUS_OPTIONS, effectiveStatus } from '~/utils/status'

const supabase = useSupabaseClient()
const store = useProfileStore()
const chat = useChatStore()
const user = useSupabaseUser()
const toast = useToast()

useHead({ title: computed(() => (chat.totalUnread ? `(${chat.totalUnread}) CompanyChat` : 'CompanyChat')) })

watch(
  user,
  (u) => {
    if (!u) return
    store.load().catch(async (e) => {
      // No profile row visible (PGRST116) means the account was deactivated: end the session.
      if (e?.code === 'PGRST116') {
        await supabase.auth.signOut()
        chat.reset()
        await navigateTo('/login')
      }
    })
    chat.start()
    chat.load().catch((e) => toast.add({ title: 'Could not load chats', description: String(e?.message ?? e), color: 'error' }))
  },
  { immediate: true },
)

const items = computed(() => [
  STATUS_OPTIONS.map((s) => ({
    label: s.label,
    onSelect: () => store.setStatus(s.value).catch(() => toast.add({ title: 'Could not update status', color: 'error' })),
  })),
  ...(store.isAdmin ? [[{ label: 'Manage users', icon: 'i-lucide-shield', to: '/admin/users' }]] : []),
  [{
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    onSelect: async () => {
      await supabase.auth.signOut()
      store.profile = null
      chat.reset()
      await navigateTo('/login')
    },
  }],
])
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex items-center justify-between border-b border-default px-4 py-2">
      <NuxtLink to="/" class="font-semibold">CompanyChat</NuxtLink>
      <UDropdownMenu v-if="store.profile" :items="items">
        <UButton color="neutral" variant="ghost">
          <StatusDot :status="effectiveStatus(store.profile.status, true)" />
          {{ store.profile.display_name }}
        </UButton>
      </UDropdownMenu>
    </header>
    <div class="flex min-h-0 flex-1">
      <AppSidebar />
      <main class="min-w-0 flex-1"><slot /></main>
    </div>
  </div>
</template>
