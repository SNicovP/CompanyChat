<script setup lang="ts">
import type { Database } from '~/types/database.types'

type AppRole = Database['public']['Enums']['app_role']
interface UserRow {
  id: string
  email: string
  display_name: string
  app_role: AppRole
}

const supabase = useSupabaseClient<Database>()
const store = useProfileStore()
const chat = useChatStore()
const toast = useToast()

const users = ref<UserRow[]>([])
const loading = ref(true)

const isOwner = computed(() => store.profile?.app_role === 'owner')
const roleItems = [
  { label: 'Admin', value: 'admin' },
  { label: 'Member', value: 'member' },
]

async function load() {
  const { data, error } = await supabase.from('profiles').select('id, email, display_name, app_role').order('display_name')
  loading.value = false
  if (error) {
    toast.add({ title: 'Could not load users', description: errorMessage(error), color: 'error' })
    return
  }
  users.value = data
}

async function changeRole(user: UserRow, role: AppRole) {
  const { error } = await supabase.rpc('set_app_role', { target: user.id, new_role: role })
  if (error) toast.add({ title: 'Could not change role', description: errorMessage(error), color: 'error' })
  await load()
  await chat.load()
}

watch(() => store.profile?.id, (id) => { if (id) load() }, { immediate: true })
</script>

<template>
  <div class="mx-auto h-full max-w-3xl space-y-4 overflow-y-auto p-6">
    <p v-if="store.profile && !store.isAdmin" class="text-muted">You don't have access to this page.</p>
    <template v-else-if="store.profile">
      <h1 class="text-2xl font-semibold">Users</h1>
      <UAlert
        color="neutral"
        variant="subtle"
        title="Adding people"
        description="Invite people from the Supabase dashboard (Authentication → Users → Invite user). They appear here after their first sign-in, and you add them to clients and projects from the client page."
      />
      <p v-if="!isOwner" class="text-sm text-muted">Only the owner can change app roles.</p>

      <p v-if="loading" class="text-muted">Loading…</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="u in users" :key="u.id" class="flex items-center justify-between gap-3 py-2">
          <div>
            <div>{{ u.display_name }}<span v-if="u.id === store.profile.id" class="text-muted"> (you)</span></div>
            <div class="text-xs text-muted">{{ u.email }}</div>
          </div>
          <UBadge v-if="u.app_role === 'owner'" color="primary" variant="subtle">Owner</UBadge>
          <USelect
            v-else-if="isOwner"
            :model-value="u.app_role"
            :items="roleItems"
            size="sm"
            class="w-32"
            @update:model-value="(r: string) => changeRole(u, r as AppRole)"
          />
          <UBadge v-else color="neutral" variant="subtle" class="capitalize">{{ u.app_role }}</UBadge>
        </li>
      </ul>
    </template>
  </div>
</template>
