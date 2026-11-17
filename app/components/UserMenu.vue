<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { webrtcSupported } from '~/utils/peer'

// Right-click (or long-press) menu for a person: message, call, intercom (admins), block. Wraps whatever shows them.
const props = defineProps<{ userId: string | null | undefined }>()

const chat = useChatStore()
const calls = useCallStore()
const rooms = useRoomsStore()
const blocks = useBlocksStore()
const profile = useProfileStore()
const toast = useToast()

const person = computed(() => (props.userId ? chat.directory[props.userId] : undefined))
const enabled = computed(() => !!person.value && props.userId !== chat.myId)

async function openDm(): Promise<string | null> {
  try {
    const id = await chat.startDm(props.userId!)
    await navigateTo(`/c/${id}`)
    return id
  } catch (e) {
    toast.add({ title: 'Could not open conversation', description: errorMessage(e), color: 'error' })
    return null
  }
}

async function call() {
  const id = await openDm()
  if (id) await calls.start(id)
}

const items = computed<ContextMenuItem[][]>(() => {
  const p = person.value
  if (!p) return []
  const blockedWhy = blocks.reason(p.id)
  const inactive = !p.is_active
  const canCall = import.meta.client && webrtcSupported() && !inactive && !blockedWhy
  return [
    [{ type: 'label', label: p.display_name }],
    [
      { label: 'Message', icon: 'i-lucide-message-square', disabled: inactive, onSelect: () => void openDm() },
      { label: 'Voice call', icon: 'i-lucide-phone', disabled: !canCall || calls.busy || rooms.talking, onSelect: () => void call() },
      ...(profile.isAdmin
        ? [{
            label: 'Intercom',
            description: 'Talk live; they hear you without answering',
            icon: 'i-lucide-megaphone',
            disabled: !canCall || calls.busy || rooms.talking || chat.displayStatus(p.id) === 'dnd',
            onSelect: () => void rooms.intercom(p.id),
          }]
        : []),
    ],
    [
      blocks.iBlocked(p.id)
        ? { label: 'Unblock', icon: 'i-lucide-circle-check', onSelect: () => void blocks.unblock(p.id) }
        : { label: 'Block…', icon: 'i-lucide-ban', color: 'error' as const, onSelect: () => { blocks.confirming = p.id } },
    ],
  ]
})
</script>

<template>
  <UContextMenu v-if="enabled" :items="items">
    <slot />
  </UContextMenu>
  <slot v-else />
</template>
