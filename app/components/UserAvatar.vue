<script setup lang="ts">
import type { DisplayStatus } from '~/utils/status'

// A round initials avatar with a stable colour per person and an optional presence dot.
const props = withDefaults(defineProps<{ name: string; status?: DisplayStatus; size?: 'sm' | 'md'; ring?: 'muted' | 'default' }>(), { size: 'md', ring: 'muted' })

// Full class names so Tailwind includes them.
const PALETTE = [
  'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
]

const color = computed(() => {
  let h = 0
  for (const ch of props.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
})
const initials = computed(() => {
  const words = props.name.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words[words.length - 1]![0] ?? '') : '')).toUpperCase()
})
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <span
      class="inline-flex items-center justify-center rounded-full font-semibold"
      :class="[color, size === 'sm' ? 'size-6 text-[10px]' : 'size-9 text-sm']"
      aria-hidden="true"
    >{{ initials }}</span>
    <StatusDot
      v-if="status"
      :status="status"
      size="sm"
      class="absolute -bottom-0.5 -right-0.5 ring-2"
      :class="ring === 'muted' ? 'ring-[var(--ui-bg-muted)]' : 'ring-[var(--ui-bg)]'"
    />
  </span>
</template>
