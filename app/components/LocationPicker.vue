<script setup lang="ts">
import type { ApiLocationShare } from '~/types/api'

// Share a location: your current position (GPS), or coordinates / a maps link you paste. Optional name.
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ share: [share: ApiLocationShare] }>()

const point = ref<{ lat: number; lng: number; accuracy?: number } | null>(null)
const locating = ref(false)
const problem = ref('')
const label = ref('')
const manual = ref('')

function locate() {
  problem.value = ''
  if (!navigator.geolocation) {
    problem.value = 'This device cannot report its location. Paste coordinates or a maps link instead.'
    return
  }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      point.value = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
      manual.value = ''
    },
    (err) => {
      locating.value = false
      problem.value = err.code === err.PERMISSION_DENIED
        ? "CompanyChat isn't allowed to see your location. Allow it in your browser or system settings, or paste coordinates below."
        : 'Could not find your location. Try again, or paste coordinates below.'
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  )
}

const parsed = computed(() => (manual.value.trim() ? parseCoordinates(manual.value) : null))
watch(parsed, (p) => {
  if (!p) return
  point.value = { ...p }
  problem.value = ''
})

function send() {
  if (!point.value) return
  emit('share', { type: 'location', lat: point.value.lat, lng: point.value.lng, ...(label.value.trim() ? { label: label.value.trim() } : {}) })
  open.value = false
}

watch(open, (o) => {
  if (!o) return
  point.value = null
  label.value = ''
  manual.value = ''
  problem.value = ''
  locate()
}, { immediate: true })
</script>

<template>
  <UModal v-model:open="open" title="Share a location">
    <template #body>
      <div class="space-y-4">
        <div class="overflow-hidden rounded-xl border border-default">
          <StaticMap v-if="point" :lat="point.lat" :lng="point.lng" :width="480" :height="200" :zoom="16" class="max-w-none!" />
          <div v-else class="flex aspect-[480/200] items-center justify-center gap-2 bg-elevated text-sm text-muted">
            <template v-if="locating"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Finding your location…</template>
            <template v-else><UIcon name="i-lucide-map-pin-off" class="size-4" /> No location yet</template>
          </div>
          <div class="flex items-center gap-2 border-t border-default px-3 py-2 text-sm">
            <UIcon name="i-lucide-locate-fixed" class="size-4 text-primary" />
            <span v-if="point" class="flex-1 tabular-nums text-toned">
              {{ formatCoords(point.lat, point.lng) }}
              <span v-if="point.accuracy" class="text-xs text-muted">· accurate to {{ Math.round(point.accuracy) }} m</span>
            </span>
            <span v-else class="flex-1 text-muted">Current location</span>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="locating" @click="locate">Use my location</UButton>
          </div>
        </div>
        <p v-if="problem" class="text-sm text-warning">{{ problem }}</p>
        <UFormField label="Name (optional)" hint="e.g. Client office, Site gate">
          <UInput v-model="label" maxlength="200" placeholder="What is this place?" class="w-full" @keydown.enter.prevent="send" />
        </UFormField>
        <UFormField label="Or paste coordinates or a map link" :error="manual.trim() && !parsed ? 'Not recognised. Try “-33.92, 18.42” or a Google Maps link.' : undefined">
          <UInput v-model="manual" placeholder="-33.9249, 18.4241" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
        <UButton icon="i-lucide-send-horizontal" :disabled="!point" @click="send">Send location</UButton>
      </div>
    </template>
  </UModal>
</template>
