<script setup lang="ts">
// "Typing…" in every chat (DMs also show it in the header), like WhatsApp: the people typing (initials avatars, so no profile pictures are needed)
// next to a bubble with three moving dots. More than MAX_SHOWN people collapse into a "+N".
const props = defineProps<{ names: string[] }>()

const MAX_SHOWN = 3
const shown = computed(() => props.names.slice(0, MAX_SHOWN))
const extra = computed(() => Math.max(0, props.names.length - MAX_SHOWN))
const label = computed(() => {
  const n = props.names
  if (n.length === 1) return `${n[0]} is typing`
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing`
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]} are typing`
})
</script>

<template>
  <div class="flex items-center gap-2 px-2 pt-2" role="status" :title="label">
    <span class="sr-only">{{ label }}</span>
    <span class="flex -space-x-1" aria-hidden="true">
      <UserAvatar v-for="(name, i) in shown" :key="`${i}-${name}`" :name="name" size="sm" ring="default" class="rounded-full ring-2 ring-[var(--ui-bg)]" />
      <span v-if="extra" class="relative inline-flex size-6 items-center justify-center rounded-full bg-accented text-[10px] font-semibold text-toned ring-2 ring-[var(--ui-bg)]">+{{ extra }}</span>
    </span>
    <span class="inline-flex items-center gap-1 rounded-2xl bg-elevated px-3 py-2.5" aria-hidden="true">
      <span v-for="i in 3" :key="i" class="typing-dot size-1.5 rounded-full bg-primary" :style="{ animationDelay: `${(i - 1) * 0.2}s` }" />
    </span>
  </div>
</template>
