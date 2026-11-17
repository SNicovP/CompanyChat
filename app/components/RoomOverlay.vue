<script setup lang="ts">
import { namesSummary } from '~/utils/mesh'
import { formatCallDuration } from '~/utils/peer'

// The floating panel of a group call or announcement we are in, and the audio of everyone we hear.
const rooms = useRoomsStore()
const chat = useChatStore()

// one <audio> per person; a listener who has not touched the page yet may need to tap before the browser plays sound
const blocked = ref(false)
const players = new Map<string, HTMLAudioElement>()
function bind(id: string, el: unknown) {
  if (!(el instanceof HTMLAudioElement)) {
    players.delete(id)
    return
  }
  players.set(id, el)
  const stream = rooms.remote[id] ?? null
  if (el.srcObject !== stream) {
    el.srcObject = stream
    if (stream) el.play().then(() => { blocked.value = false }).catch(() => { blocked.value = true })
  }
}
function playAll() {
  blocked.value = false
  for (const el of players.values()) void el.play().catch(() => { blocked.value = true })
}
watch(() => rooms.phase, (p) => { if (p === 'idle') blocked.value = false })

const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
watch(() => rooms.joinedAt, (at) => {
  if (tick) clearInterval(tick)
  tick = at ? setInterval(() => { now.value = Date.now() }, 1000) : null
  now.value = Date.now()
})
onBeforeUnmount(() => { if (tick) clearInterval(tick) })
const elapsed = computed(() => (rooms.joinedAt ? formatCallDuration((now.value - rooms.joinedAt) / 1000) : ''))

const room = computed(() => rooms.current)
const title = computed(() => {
  const r = room.value
  if (!r) return ''
  if (rooms.role === 'member') return `Call in ${rooms.audienceName(r)}`
  if (rooms.role === 'speaker') return `Announcing to ${rooms.audienceName(r)}`
  return `${chat.userName(r.started_by)} · ${rooms.audienceName(r)}`
})
const others = computed(() => rooms.members.filter((m) => m.role === 'member'))
const subtitle = computed(() => {
  if (rooms.phase === 'joining') return rooms.role === 'listener' ? 'Tuning in…' : 'Joining…'
  if (rooms.role === 'speaker') return `${rooms.listeners} listening · ${elapsed.value} / 5:00`
  if (rooms.role === 'listener') return `Live announcement · ${elapsed.value}`
  if (!others.value.length) return `Waiting for others · ${elapsed.value}`
  return `${namesSummary(others.value.map((m) => chat.userName(m.id)))} · ${elapsed.value}`
})
const unreachable = computed(() => Object.entries(rooms.linkStates).filter(([, s]) => s === 'failed').map(([id]) => chat.userName(id)))
const icon = computed(() => (rooms.role === 'member' ? 'i-lucide-users' : 'i-lucide-megaphone'))
const leaveLabel = computed(() => (rooms.role === 'speaker' ? 'End announcement' : rooms.role === 'listener' ? 'Stop listening' : 'Leave call'))
</script>

<template>
  <audio v-for="(_, id) in rooms.remote" :key="id" :ref="(el) => bind(String(id), el)" autoplay playsinline class="hidden" />

  <Transition
    enter-active-class="transition duration-200"
    enter-from-class="translate-y-4 opacity-0"
    leave-active-class="transition duration-150"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="room || rooms.phase === 'joining'"
      class="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-default bg-elevated px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      role="region"
      :aria-label="title || 'Group call'"
    >
      <div class="flex items-center gap-3">
        <span class="relative flex size-10 shrink-0 items-center justify-center rounded-full" :class="rooms.role === 'member' ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning'">
          <UIcon :name="icon" class="size-5" />
          <span v-if="rooms.phase === 'live' && rooms.role !== 'member'" class="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-error" aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-highlighted">{{ title || '…' }}</p>
          <p class="truncate text-xs tabular-nums text-muted" aria-live="polite">{{ subtitle }}</p>
        </div>
        <UButton
          v-if="rooms.role !== 'listener'"
          :icon="rooms.muted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
          :color="rooms.muted ? 'warning' : 'neutral'"
          variant="soft"
          class="rounded-full"
          :aria-label="rooms.muted ? 'Unmute' : 'Mute'"
          :title="rooms.muted ? 'Unmute' : 'Mute'"
          @click="rooms.toggleMute()"
        />
        <UButton icon="i-lucide-phone-off" color="error" class="rounded-full" :aria-label="leaveLabel" :title="leaveLabel" @click="rooms.leave()" />
      </div>

      <div v-if="rooms.role === 'member' && others.length" class="mt-2 flex flex-wrap gap-1.5">
        <span
          v-for="m in others"
          :key="m.id"
          class="flex items-center gap-1.5 rounded-full bg-default px-2 py-0.5 text-xs"
          :class="rooms.linkStates[m.id] === 'failed' ? 'text-error' : rooms.linkStates[m.id] === 'connected' ? 'text-highlighted' : 'text-muted'"
        >
          <span class="size-1.5 rounded-full" :class="rooms.linkStates[m.id] === 'connected' ? 'bg-success' : rooms.linkStates[m.id] === 'failed' ? 'bg-error' : 'bg-warning'" />
          {{ chat.userName(m.id) }}
        </span>
      </div>
      <p v-if="unreachable.length && rooms.role !== 'listener'" class="mt-2 text-xs text-error">
        Can't reach {{ namesSummary(unreachable) }}: their network may block direct calls.
      </p>
      <UButton v-if="blocked" block class="mt-2" icon="i-lucide-volume-2" @click="playAll">Tap to listen</UButton>
    </div>
  </Transition>
</template>
