<script setup lang="ts">
import { displayMeta, type DisplayStatus } from '~/utils/status'

const props = withDefaults(defineProps<{ status: DisplayStatus; size?: 'sm' | 'md' }>(), { size: 'md' })
const meta = computed(() => displayMeta(props.status))
</script>

<template>
  <span
    class="inline-block shrink-0 rounded-full"
    :class="[meta.color, size === 'sm' ? 'size-2' : 'size-2.5']"
    :title="meta.label"
    role="img"
    :aria-label="meta.label"
  />
</template>
