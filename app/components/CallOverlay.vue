<script setup lang="ts">
import { formatCallDuration } from '~/utils/peer'

// The incoming-call prompt and the floating panel of a call in progress. Mounted once, in the default layout.
const calls = useCallStore()
const chat = useChatStore()

const audio = ref<HTMLAudioElement | null>(null)
watch(() => calls.remoteStream, (stream) => {
  if (!audio.value) return
  audio.value.srcObject = stream
  if (stream) void audio.value.play().catch(() => {}) // a call is always started by a click, so autoplay is allowed
})

// tick once a second for the timer
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
watch(() => calls.connectedAt, (at) => {
  if (tick) clearInterval(tick)
  tick = at ? setInterval(() => { now.value = Date.now() }, 1000) : null
  now.value = Date.now()
})
onBeforeUnmount(() => { if (tick) clearInterval(tick) })

const status = computed(() => {
  switch (calls.phase) {
    case 'outgoing': return calls.call ? 'Ringing…' : 'Calling…'
    case 'connecting': return 'Connecting…'
    case 'reconnecting': return 'Reconnecting…'
    case 'active': return calls.connectedAt ? formatCallDuration((now.value - calls.connectedAt) / 1000) : 'Connected'
    default: return ''
  }
})

const showPanel = computed(() => calls.phase !== 'idle' && calls.phase !== 'incoming')
const incomingOpen = computed(() => calls.phase === 'incoming')
const name = computed(() => calls.peerName || 'Someone')
</script>

<template>
  <audio ref="audio" autoplay playsinline class="hidden" />

  <UModal
    :open="incomingOpen"
    :dismissible="false"
    :close="false"
    title="Incoming voice call"
    :description="`${name} is calling you`"
    :ui="{ content: 'max-w-sm' }"
  >
    <template #body>
      <div class="flex flex-col items-center gap-3 py-2 text-center">
        <span class="relative">
          <span class="absolute inset-0 animate-ping rounded-full bg-primary/30" />
          <UserAvatar :name="name" :status="chat.displayStatus(calls.peerId ?? undefined)" class="relative scale-150" />
        </span>
        <p class="mt-3 text-lg font-semibold text-highlighted">{{ name }}</p>
        <p class="text-sm text-muted">Voice call</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-center gap-6">
        <UButton icon="i-lucide-phone-off" color="error" size="xl" class="rounded-full" aria-label="Decline" @click="calls.decline()">Decline</UButton>
        <UButton icon="i-lucide-phone" color="success" size="xl" class="rounded-full" aria-label="Answer" @click="calls.accept()">Answer</UButton>
      </div>
    </template>
  </UModal>

  <Transition
    enter-active-class="transition duration-200"
    enter-from-class="translate-y-4 opacity-0"
    leave-active-class="transition duration-150"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="showPanel"
      class="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl border border-default bg-elevated px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80"
      role="region"
      aria-label="Call in progress"
    >
      <UserAvatar :name="name" :status="chat.displayStatus(calls.peerId ?? undefined)" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted">{{ name }}</p>
        <p class="truncate text-xs tabular-nums" :class="calls.phase === 'reconnecting' ? 'text-warning' : 'text-muted'" aria-live="polite">{{ status }}</p>
      </div>
      <UButton
        :icon="calls.muted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
        :color="calls.muted ? 'warning' : 'neutral'"
        variant="soft"
        class="rounded-full"
        :aria-label="calls.muted ? 'Unmute' : 'Mute'"
        :title="calls.muted ? 'Unmute' : 'Mute'"
        @click="calls.toggleMute()"
      />
      <UButton icon="i-lucide-phone-off" color="error" class="rounded-full" aria-label="Hang up" title="Hang up" @click="calls.hangup()" />
    </div>
  </Transition>
</template>
