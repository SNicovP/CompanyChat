<script setup lang="ts">
// Full-screen viewer for the photos and videos in a message: swipe/arrow between them, zoom photos, download.
export interface MediaItem {
  id: string
  kind: 'image' | 'video'
  url?: string
  file_name: string
}

const props = defineProps<{ items: MediaItem[]; caption?: string; sender?: string; sentAt?: string }>()
const open = defineModel<boolean>('open', { default: false })
const index = defineModel<number>('index', { default: 0 })
const api = useApi()
const toast = useToast()

const item = computed(() => props.items[index.value])
const zoomed = ref(false)
watch(index, () => (zoomed.value = false))
watch(open, (o) => { if (!o) zoomed.value = false })

const go = (d: number) => {
  if (props.items.length < 2) return
  index.value = (index.value + d + props.items.length) % props.items.length
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// Swipe left/right on touch screens.
let touchX: number | null = null
const onTouchStart = (e: TouchEvent) => { touchX = zoomed.value ? null : (e.touches[0]?.clientX ?? null) }
function onTouchEnd(e: TouchEvent) {
  if (touchX === null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX
  if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
  touchX = null
}

async function download() {
  const it = item.value
  if (!it) return
  try {
    const res = await api<{ urls: Record<string, string> | unknown[] }>('/attachments/urls', { method: 'POST', body: { ids: [it.id], download: true } })
    const url = Array.isArray(res.urls) ? null : res.urls[it.id]
    if (!url) throw new Error('This file is no longer available.')
    const a = document.createElement('a')
    a.href = url
    a.download = it.file_name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) {
    toast.add({ title: 'Could not download', description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <UModal v-model:open="open" fullscreen :ui="{ content: 'bg-black text-white' }" :title="item?.file_name ?? 'Media'" :description="sender">
    <template #content>
      <div class="flex h-full flex-col" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <div class="flex items-center gap-2 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ sender ?? item?.file_name }}</p>
            <p class="truncate text-xs text-white/60">
              <template v-if="sentAt">{{ new Date(sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }}</template>
              <template v-if="items.length > 1"> · {{ index + 1 }} of {{ items.length }}</template>
            </p>
          </div>
          <UButton
            v-if="item?.kind === 'image'"
            :icon="zoomed ? 'i-lucide-zoom-out' : 'i-lucide-zoom-in'"
            color="neutral"
            variant="ghost"
            class="text-white hover:bg-white/10"
            :aria-label="zoomed ? 'Fit to screen' : 'Actual size'"
            @click="zoomed = !zoomed"
          />
          <UButton icon="i-lucide-download" color="neutral" variant="ghost" class="text-white hover:bg-white/10" aria-label="Download" @click="download" />
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" class="text-white hover:bg-white/10" aria-label="Close" @click="open = false" />
        </div>

        <div class="relative flex min-h-0 flex-1 items-center justify-center" :class="zoomed ? 'overflow-auto' : 'overflow-hidden'">
          <template v-if="item">
            <img
              v-if="item.kind === 'image' && item.url"
              :key="item.id"
              :src="item.url"
              :alt="item.file_name"
              class="select-none"
              :class="zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'"
              @click="zoomed = !zoomed"
            />
            <video
              v-else-if="item.kind === 'video' && item.url"
              :key="item.id"
              :src="item.url"
              controls
              autoplay
              playsinline
              class="max-h-full max-w-full"
            />
            <UIcon v-else name="i-lucide-loader-circle" class="size-8 animate-spin text-white/60" />
          </template>
          <template v-if="items.length > 1">
            <UButton icon="i-lucide-chevron-left" color="neutral" variant="solid" size="lg" class="absolute left-3 rounded-full opacity-80" aria-label="Previous" @click="go(-1)" />
            <UButton icon="i-lucide-chevron-right" color="neutral" variant="solid" size="lg" class="absolute right-3 rounded-full opacity-80" aria-label="Next" @click="go(1)" />
          </template>
        </div>

        <p v-if="caption" class="mx-auto max-w-3xl whitespace-pre-wrap break-words px-4 py-3 text-center text-sm text-white/90">{{ caption }}</p>
        <div v-if="items.length > 1" class="flex justify-center gap-2 overflow-x-auto px-3 pb-3">
          <button
            v-for="(m, i) in items"
            :key="m.id"
            type="button"
            class="size-14 shrink-0 overflow-hidden rounded-md border-2 bg-white/10"
            :class="i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'"
            :aria-label="`Show ${m.file_name}`"
            @click="index = i"
          >
            <img v-if="m.kind === 'image' && m.url" :src="m.url" alt="" class="size-full object-cover" />
            <span v-else class="flex size-full items-center justify-center"><UIcon name="i-lucide-play" class="size-5" /></span>
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>
