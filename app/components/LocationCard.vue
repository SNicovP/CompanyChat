<script setup lang="ts">
import type { ApiLocationShare } from '~/types/api'

// A shared location in a message: map preview + label. Opens an interactive map with directions.
const props = defineProps<{ share: ApiLocationShare; sender?: string; sentAt?: string }>()
const open = ref(false)
const toast = useToast()

async function copyCoords() {
  try {
    await navigator.clipboard.writeText(formatCoords(props.share.lat, props.share.lng))
    toast.add({ title: 'Coordinates copied', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy', color: 'error' })
  }
}
</script>

<template>
  <div class="mt-1">
    <button
      type="button"
      class="block w-80 max-w-full overflow-hidden rounded-xl border border-default bg-elevated/60 text-left transition hover:border-accented hover:shadow-sm"
      :aria-label="`Open map: ${share.label || 'shared location'}`"
      @click="open = true"
    >
      <StaticMap :lat="share.lat" :lng="share.lng" :width="320" :height="150" />
      <div class="flex items-center gap-2 px-3 py-2">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <UIcon name="i-lucide-map-pin" class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ share.label || 'Shared location' }}</p>
          <p class="truncate text-xs tabular-nums text-muted">{{ formatCoords(share.lat, share.lng) }}</p>
        </div>
      </div>
    </button>

    <UModal v-model:open="open" :title="share.label || 'Shared location'" :description="sender ? `Shared by ${sender}` : undefined" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <iframe
          :src="osmEmbedUrl(share.lat, share.lng)"
          title="Map"
          class="h-[55vh] w-full rounded-lg border border-default"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
        />
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton :to="directionsUrl(share.lat, share.lng)" target="_blank" icon="i-lucide-navigation">Directions</UButton>
          <UButton :to="googleMapsUrl(share.lat, share.lng)" target="_blank" color="neutral" variant="outline" icon="i-lucide-map">Google Maps</UButton>
          <UButton :to="osmUrl(share.lat, share.lng)" target="_blank" color="neutral" variant="outline" icon="i-lucide-globe">OpenStreetMap</UButton>
          <UButton color="neutral" variant="ghost" icon="i-lucide-copy" @click="copyCoords">{{ formatCoords(share.lat, share.lng) }}</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
