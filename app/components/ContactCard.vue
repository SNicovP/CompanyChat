<script setup lang="ts">
import type { ApiContactShare } from '~/types/api'

// A shared contact in a message. Opens a contact sheet with call / email / message / save actions.
const props = defineProps<{ share: ApiContactShare; sender?: string }>()
const chat = useChatStore()
const toast = useToast()
const open = ref(false)
const starting = ref(false)

const teammate = computed(() => (props.share.user_id ? chat.directory[props.share.user_id] : undefined))
const canMessage = computed(() => !!teammate.value && teammate.value.id !== chat.myId)
const subtitle = computed(() => props.share.org || props.share.phone || props.share.email || (teammate.value ? 'On CompanyChat' : ''))

async function message() {
  if (!props.share.user_id) return
  starting.value = true
  try {
    const id = await chat.startDm(props.share.user_id)
    open.value = false
    await navigateTo(`/c/${id}`)
  } catch (e) {
    toast.add({ title: 'Could not open the chat', description: errorMessage(e), color: 'error' })
  } finally {
    starting.value = false
  }
}

function save() {
  const blob = new Blob([toVCard(props.share)], { type: 'text/vcard' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName(props.share.name)}.vcf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy', color: 'error' })
  }
}
</script>

<template>
  <div class="mt-1">
    <button
      type="button"
      class="flex w-72 max-w-full items-center gap-3 rounded-xl border border-default bg-elevated/60 px-3 py-2.5 text-left transition hover:border-accented hover:shadow-sm"
      :aria-label="`Open contact ${share.name}`"
      @click="open = true"
    >
      <UserAvatar :name="share.name" :status="teammate ? chat.displayStatus(teammate.id) : undefined" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted">{{ share.name }}</p>
        <p class="truncate text-xs text-muted">{{ subtitle }}</p>
      </div>
      <UIcon name="i-lucide-contact" class="size-4 shrink-0 text-muted" />
    </button>

    <UModal v-model:open="open" :title="share.name" :description="sender ? `Contact shared by ${sender}` : undefined">
      <template #body>
        <div class="flex flex-col items-center gap-2 pb-2 text-center">
          <UserAvatar :name="share.name" :status="teammate ? chat.displayStatus(teammate.id) : undefined" class="scale-150" />
          <p class="mt-3 text-lg font-semibold text-highlighted">{{ share.name }}</p>
          <p v-if="share.org" class="text-sm text-muted">{{ share.org }}</p>
          <UBadge v-if="teammate" color="primary" variant="subtle" icon="i-lucide-message-circle">On CompanyChat</UBadge>
        </div>
        <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
          <li v-if="share.phone" class="flex items-center gap-3 px-3 py-2">
            <UIcon name="i-lucide-phone" class="size-4 text-muted" />
            <a :href="telHref(share.phone)" class="flex-1 text-sm text-highlighted hover:underline">{{ share.phone }}</a>
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Copy phone number" @click="copy(share.phone, 'Phone number')" />
          </li>
          <li v-if="share.email" class="flex items-center gap-3 px-3 py-2">
            <UIcon name="i-lucide-mail" class="size-4 text-muted" />
            <a :href="`mailto:${share.email}`" class="flex-1 truncate text-sm text-highlighted hover:underline">{{ share.email }}</a>
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Copy email" @click="copy(share.email, 'Email')" />
          </li>
          <li v-if="!share.phone && !share.email" class="px-3 py-2 text-sm text-muted">No phone number or email.</li>
        </ul>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <UButton v-if="share.phone" :to="telHref(share.phone)" icon="i-lucide-phone" color="neutral" variant="soft" block>Call</UButton>
          <UButton v-if="share.email" :to="`mailto:${share.email}`" icon="i-lucide-mail" color="neutral" variant="soft" block>Email</UButton>
          <UButton v-if="canMessage" icon="i-lucide-message-circle" :loading="starting" block @click="message">Message</UButton>
          <UButton icon="i-lucide-user-plus" color="neutral" variant="soft" block @click="save">Save</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
