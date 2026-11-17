<script setup lang="ts">
import type { ApiCallShare } from '~/types/api'
import { formatCallDuration } from '~/utils/peer'

// A call-history entry in a DM (the message's author is the caller).
const props = defineProps<{ share: ApiCallShare; callerId: string | null; channelId: string }>()
const chat = useChatStore()
const calls = useCallStore()

const outgoing = computed(() => props.callerId === chat.myId)
const view = computed(() => {
  const s = props.share
  const length = s.duration ? formatCallDuration(s.duration) : null
  switch (s.status) {
    case 'ended':
      return { icon: outgoing.value ? 'i-lucide-phone-outgoing' : 'i-lucide-phone-incoming', title: outgoing.value ? 'Outgoing voice call' : 'Incoming voice call', detail: length, bad: false }
    case 'missed':
    case 'cancelled':
      return outgoing.value
        ? { icon: 'i-lucide-phone-outgoing', title: s.status === 'missed' ? 'No answer' : 'Cancelled call', detail: null, bad: false }
        : { icon: 'i-lucide-phone-missed', title: 'Missed voice call', detail: null, bad: true }
    case 'rejected':
      return { icon: 'i-lucide-phone-off', title: outgoing.value ? 'Call declined' : 'You declined a call', detail: null, bad: outgoing.value }
    default:
      return { icon: 'i-lucide-phone-off', title: 'Call failed', detail: length ? `Dropped after ${length}` : "Couldn't connect", bad: true }
  }
})
</script>

<template>
  <div class="mt-1 flex w-72 max-w-full items-center gap-3 rounded-xl border border-default bg-elevated/60 px-3 py-2.5">
    <span class="flex size-9 shrink-0 items-center justify-center rounded-full" :class="view.bad ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'">
      <UIcon :name="view.icon" class="size-4" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold" :class="view.bad ? 'text-error' : 'text-highlighted'">{{ view.title }}</p>
      <p v-if="view.detail" class="truncate text-xs tabular-nums text-muted">{{ view.detail }}</p>
    </div>
    <UButton
      icon="i-lucide-phone"
      size="sm"
      color="neutral"
      variant="ghost"
      :disabled="calls.busy"
      :aria-label="outgoing ? 'Call again' : 'Call back'"
      :title="outgoing ? 'Call again' : 'Call back'"
      @click="calls.start(channelId)"
    />
  </div>
</template>
