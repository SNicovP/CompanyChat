<script setup lang="ts">
import type { ApiContactShare } from '~/types/api'

// Share a contact: a teammate from CompanyChat, someone from the phone's contacts (where the browser allows it),
// or details typed in.
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ share: [share: ApiContactShare] }>()
const chat = useChatStore()
const toast = useToast()

const tab = ref<'people' | 'new'>('people')
const query = ref('')
const form = reactive({ name: '', phone: '', email: '', org: '' })

const people = computed(() => filterPeople(chat.activePeople.filter((u) => u.id !== chat.myId), query.value, 50))

// The Contact Picker API: Chrome on Android only.
type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]> }
const contacts = import.meta.client ? (navigator as Navigator & { contacts?: ContactsManager }).contacts : undefined
const canPickDevice = !!contacts?.select

async function pickFromDevice() {
  try {
    const [c] = await contacts!.select(['name', 'tel', 'email'], { multiple: false })
    if (!c) return
    form.name = c.name?.[0] ?? ''
    form.phone = c.tel?.[0] ?? ''
    form.email = c.email?.[0] ?? ''
    tab.value = 'new'
  } catch (e) {
    toast.add({ title: 'Could not open your contacts', description: errorMessage(e), color: 'error' })
  }
}

function shareTeammate(u: { id: string; display_name: string }) {
  emit('share', { type: 'contact', name: u.display_name, user_id: u.id })
  open.value = false
}

const emailOk = computed(() => !form.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
const phoneOk = computed(() => /^[0-9+()\-.\s]*$/.test(form.phone))
const canSend = computed(() => !!form.name.trim() && (!!form.phone.trim() || !!form.email.trim()) && emailOk.value && phoneOk.value)

function shareTyped() {
  if (!canSend.value) return
  const clean = (v: string) => v.trim() || undefined
  emit('share', { type: 'contact', name: form.name.trim(), phone: clean(form.phone), email: clean(form.email), org: clean(form.org) })
  open.value = false
}

watch(open, (o) => {
  if (!o) return
  tab.value = 'people'
  query.value = ''
  Object.assign(form, { name: '', phone: '', email: '', org: '' })
})
</script>

<template>
  <UModal v-model:open="open" title="Share a contact">
    <template #body>
      <div class="mb-3 flex gap-1 rounded-lg bg-elevated p-1 text-sm">
        <button
          v-for="t in [{ id: 'people', label: 'Teammate' }, { id: 'new', label: 'Phone & email' }] as const"
          :key="t.id"
          type="button"
          class="flex-1 rounded-md px-3 py-1.5 font-medium transition"
          :class="tab === t.id ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-toned'"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </div>

      <div v-if="tab === 'people'">
        <UInput v-model="query" icon="i-lucide-search" placeholder="Search people" autofocus class="mb-2 w-full" />
        <ul class="max-h-80 overflow-y-auto">
          <li v-for="u in people" :key="u.id">
            <button type="button" class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-elevated" @click="shareTeammate(u)">
              <UserAvatar :name="u.display_name" :status="chat.displayStatus(u.id)" size="sm" />
              <span class="flex-1 truncate text-sm text-highlighted">{{ u.display_name }}</span>
              <UIcon name="i-lucide-send-horizontal" class="size-4 text-muted" />
            </button>
          </li>
          <li v-if="!people.length" class="px-2 py-6 text-center text-sm text-muted">Nobody matches “{{ query }}”.</li>
        </ul>
      </div>

      <form v-else class="space-y-3" @submit.prevent="shareTyped">
        <UButton v-if="canPickDevice" icon="i-lucide-book-user" color="neutral" variant="soft" block @click="pickFromDevice">Choose from my contacts</UButton>
        <UFormField label="Name" required>
          <UInput v-model="form.name" maxlength="120" autofocus class="w-full" />
        </UFormField>
        <UFormField label="Phone" :error="phoneOk ? undefined : 'Digits, spaces and + ( ) - only'">
          <UInput v-model="form.phone" type="tel" maxlength="40" placeholder="+27 82 123 4567" class="w-full" />
        </UFormField>
        <UFormField label="Email" :error="emailOk ? undefined : 'Not a valid email address'">
          <UInput v-model="form.email" type="email" maxlength="190" class="w-full" />
        </UFormField>
        <UFormField label="Company (optional)">
          <UInput v-model="form.org" maxlength="120" class="w-full" />
        </UFormField>
        <p class="text-xs text-muted">Add a phone number or an email.</p>
        <button type="submit" class="hidden" />
      </form>
    </template>
    <template v-if="tab === 'new'" #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
        <UButton icon="i-lucide-send-horizontal" :disabled="!canSend" @click="shareTyped">Send contact</UButton>
      </div>
    </template>
  </UModal>
</template>
