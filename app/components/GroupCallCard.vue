<script setup lang="ts">
import type { ApiGroupCallShare } from '~/types/api'
import { formatCallDuration } from '~/utils/peer'

// A group-call history entry in a project channel (the author started the call).
const props = defineProps<{ share: ApiGroupCallShare; channelId: string }>()
const rooms = useRoomsStore()
const going = computed(() => rooms.callIn(props.channelId))
</script>

<template>
  <div class="mt-1 flex w-72 max-w-full items-center gap-3 rounded-xl border border-default bg-elevated/60 px-3 py-2.5">
    <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <UIcon name="i-lucide-users" class="size-4" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-highlighted">Group call</p>
      <p class="truncate text-xs tabular-nums text-muted">{{ formatCallDuration(share.duration) }} · {{ share.people }} {{ share.people === 1 ? 'person' : 'people' }}</p>
    </div>
    <UButton
      v-if="!going"
      icon="i-lucide-phone"
      size="sm"
      color="neutral"
      variant="ghost"
      :disabled="rooms.talking"
      aria-label="Start a new group call"
      title="Start a new group call"
      @click="rooms.startCall(channelId)"
    />
  </div>
</template>
