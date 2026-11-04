<script setup lang="ts">
import type { Database } from '~/types/database.types'

type AppRole = Database['public']['Enums']['app_role']
interface UserRow {
  id: string
  email: string
  display_name: string
  app_role: AppRole
  is_active: boolean
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
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, app_role, is_active')
    .order('display_name')
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

/** Call the admin-users Edge Function; surfaces the function's own error message. */
async function callAdmin(body: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return null
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json()
      if (payload?.error) return String(payload.error)
    } catch { /* fall through */ }
  }
  return errorMessage(error)
}

const inviteEmail = ref('')
const inviteName = ref('')
const inviting = ref(false)

async function invite() {
  inviting.value = true
  const problem = await callAdmin({ action: 'invite', email: inviteEmail.value, display_name: inviteName.value })
  inviting.value = false
  if (problem) {
    toast.add({ title: 'Could not send invite', description: problem, color: 'error' })
    return
  }
  toast.add({ title: 'Invite sent', description: `An email with a sign-up link is on its way to ${inviteEmail.value}.` })
  inviteEmail.value = ''
  inviteName.value = ''
}

const busyId = ref<string | null>(null)

async function setActive(user: UserRow, active: boolean) {
  if (!active && !confirm(`Deactivate ${user.display_name}? They will be signed out and unable to sign in until reactivated. Their messages stay.`)) return
  busyId.value = user.id
  const problem = await callAdmin({ action: active ? 'reactivate' : 'deactivate', user_id: user.id })
  busyId.value = null
  if (problem) toast.add({ title: active ? 'Could not reactivate' : 'Could not deactivate', description: problem, color: 'error' })
  await load()
  await chat.load()
}

// Same rules as the Edge Function; the function is what actually enforces them.
function canToggle(u: UserRow) {
  if (u.id === store.profile?.id || u.app_role === 'owner') return false
  return u.app_role === 'member' || isOwner.value
}

watch(() => store.profile?.id, (id) => { if (id) load() }, { immediate: true })
</script>

<template>
  <div class="mx-auto h-full max-w-3xl space-y-6 overflow-y-auto p-6">
    <p v-if="store.profile && !store.isAdmin" class="text-muted">You don't have access to this page.</p>
    <template v-else-if="store.profile">
      <h1 class="text-2xl font-semibold">Users</h1>

      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Invite someone</h2>
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="invite">
          <UFormField label="Email" class="min-w-56 flex-1">
            <UInput v-model="inviteEmail" type="email" required class="w-full" />
          </UFormField>
          <UFormField label="Name (optional)" class="min-w-40 flex-1">
            <UInput v-model="inviteName" class="w-full" />
          </UFormField>
          <UButton type="submit" :loading="inviting" :disabled="!inviteEmail">Send invite</UButton>
        </form>
        <p class="mt-2 text-sm text-muted">They get an email, choose a password, and appear below. Then add them to clients and projects from the client page.</p>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Everyone</h2>
        <p v-if="!isOwner" class="mb-2 text-sm text-muted">Only the owner can change app roles or deactivate admins.</p>
        <p v-if="loading" class="text-muted">Loading…</p>
        <ul v-else class="divide-y divide-default">
          <li v-for="u in users" :key="u.id" class="flex items-center justify-between gap-3 py-2" :class="{ 'opacity-60': !u.is_active }">
            <div>
              <div>
                {{ u.display_name }}<span v-if="u.id === store.profile.id" class="text-muted"> (you)</span>
                <UBadge v-if="!u.is_active" color="error" variant="subtle" class="ml-2">Deactivated</UBadge>
              </div>
              <div class="text-xs text-muted">{{ u.email }}</div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge v-if="u.app_role === 'owner'" color="primary" variant="subtle">Owner</UBadge>
              <USelect
                v-else-if="isOwner && u.is_active"
                :model-value="u.app_role"
                :items="roleItems"
                size="sm"
                class="w-32"
                @update:model-value="(r: string) => changeRole(u, r as AppRole)"
              />
              <UBadge v-else color="neutral" variant="subtle" class="capitalize">{{ u.app_role }}</UBadge>
              <UButton
                v-if="canToggle(u)"
                size="xs"
                color="neutral"
                variant="outline"
                :loading="busyId === u.id"
                @click="setActive(u, !u.is_active)"
              >
                {{ u.is_active ? 'Deactivate' : 'Reactivate' }}
              </UButton>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
