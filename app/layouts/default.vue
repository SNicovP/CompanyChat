<script setup lang="ts">
import { STATUS_OPTIONS, statusMeta } from '~/utils/status'

const supabase = useSupabaseClient()
const store = useProfileStore()
const user = useSupabaseUser()
const toast = useToast()

watch(user, () => store.load().catch(() => {}), { immediate: true })

const items = computed(() => [
  STATUS_OPTIONS.map((s) => ({
    label: s.label,
    onSelect: () => store.setStatus(s.value).catch(() => toast.add({ title: 'Could not update status', color: 'error' })),
  })),
  [{
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    onSelect: async () => {
      await supabase.auth.signOut()
      store.profile = null
      await navigateTo('/login')
    },
  }],
])
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="flex items-center justify-between border-b border-default px-4 py-2">
      <span class="font-semibold">CompanyChat</span>
      <UDropdownMenu v-if="store.profile" :items="items">
        <UButton color="neutral" variant="ghost">
          <span class="inline-block size-2.5 rounded-full" :class="statusMeta(store.profile.status).color" />
          {{ store.profile.display_name }}
        </UButton>
      </UDropdownMenu>
    </header>
    <main class="flex-1"><slot /></main>
  </div>
</template>
