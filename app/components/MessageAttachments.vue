<script setup lang="ts">
import type { MediaItem } from './MediaViewer.vue'

export interface AttachmentView {
  id: string
  path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  deleted_at: string | null
}

const props = defineProps<{ attachments: AttachmentView[]; canDelete?: boolean; caption?: string; sender?: string; sentAt?: string }>()
const emit = defineEmits<{ delete: [attachment: AttachmentView] }>()
const { urls, ensure } = useAttachmentUrls()

const live = computed(() => props.attachments.filter((a) => !a.deleted_at))
// (attachments of a message still being sent have temporary ids and no file on the server yet)
const stored = computed(() => live.value.filter((a) => !a.id.startsWith('pending-')))
watch(() => stored.value.map((a) => a.id).join('|'), () => { void ensure(stored.value).catch(() => {}) }, { immediate: true })

const kindOf = (a: AttachmentView) => attachmentKind(a)
// Photos and videos show as a grid of tiles that open the viewer; audio gets a player; the rest are file chips.
const media = computed(() => live.value.filter((a) => ['image', 'video'].includes(kindOf(a))))
const audio = computed(() => live.value.filter((a) => ['voice', 'audio'].includes(kindOf(a))))
const others = computed(() => props.attachments.filter((a) => a.deleted_at || kindOf(a) === 'file'))

const viewerItems = computed<MediaItem[]>(() =>
  media.value.map((a) => ({ id: a.id, kind: kindOf(a) as 'image' | 'video', url: urls.value[a.id], file_name: a.file_name })),
)
const viewerOpen = ref(false)
const viewerIndex = ref(0)
function view(a: AttachmentView) {
  viewerIndex.value = Math.max(0, media.value.findIndex((x) => x.id === a.id))
  viewerOpen.value = true
}

// Video tiles show their length once the metadata has loaded.
const durations = ref<Record<string, number>>({})
function onVideoMeta(id: string, e: Event) {
  const d = (e.target as HTMLVideoElement).duration
  if (Number.isFinite(d)) durations.value = { ...durations.value, [id]: d }
}

const fileIcon = (a: AttachmentView) => {
  const m = a.mime_type ?? ''
  if (m === 'application/pdf') return 'i-lucide-file-text'
  if (m.startsWith('image/')) return 'i-lucide-file-image'
  if (/zip|compressed|tar/.test(m)) return 'i-lucide-file-archive'
  if (/sheet|excel|csv/.test(m)) return 'i-lucide-file-spreadsheet'
  return 'i-lucide-file'
}
</script>

<template>
  <div class="mt-1 flex flex-col gap-2">
    <!-- photos and videos -->
    <div
      v-if="media.length"
      class="grid max-w-md gap-1"
      :class="media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
    >
      <div
        v-for="(a, i) in media.slice(0, 4)"
        :key="a.id"
        class="group/attachment relative overflow-hidden rounded-lg border border-default bg-elevated"
        :class="media.length === 3 && i === 0 ? 'col-span-2' : ''"
      >
        <button
          type="button"
          class="block w-full"
          :aria-label="`Open ${a.file_name}`"
          @click="view(a)"
        >
          <template v-if="kindOf(a) === 'image'">
            <img
              v-if="urls[a.id]"
              :src="urls[a.id]"
              :alt="a.file_name"
              loading="lazy"
              class="w-full object-cover"
              :class="media.length === 1 ? 'max-h-72 object-contain' : 'h-36'"
            />
            <span v-else class="flex h-36 items-center justify-center text-muted"><UIcon name="i-lucide-image" class="size-6" /></span>
          </template>
          <template v-else>
            <video
              v-if="urls[a.id]"
              :src="`${urls[a.id]}#t=0.1`"
              preload="metadata"
              muted
              playsinline
              class="pointer-events-none w-full bg-black object-cover"
              :class="media.length === 1 ? 'max-h-72' : 'h-36'"
              @loadedmetadata="onVideoMeta(a.id, $event)"
            />
            <span v-else class="flex h-36 items-center justify-center bg-black/80" />
            <span class="absolute inset-0 flex items-center justify-center">
              <span class="flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition group-hover/attachment:scale-105">
                <UIcon name="i-lucide-play" class="size-6 translate-x-0.5" />
              </span>
            </span>
            <span class="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
              <UIcon name="i-lucide-video" class="size-3" />{{ durations[a.id] ? formatDuration(durations[a.id]!) : formatBytes(a.size_bytes) }}
            </span>
          </template>
          <span
            v-if="i === 3 && media.length > 4"
            class="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white"
          >+{{ media.length - 4 }}</span>
        </button>
        <UButton
          v-if="canDelete"
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="solid"
          class="absolute right-1 top-1 opacity-0 group-hover/attachment:opacity-100 focus:opacity-100"
          aria-label="Delete attachment"
          @click.prevent="emit('delete', a)"
        />
      </div>
    </div>

    <!-- voice notes and audio -->
    <div v-for="a in audio" :key="a.id" class="group/attachment relative w-fit max-w-full">
      <AudioPlayer :src="urls[a.id]" :voice="kindOf(a) === 'voice'" :name="a.file_name" />
      <UButton
        v-if="canDelete"
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="solid"
        class="absolute -right-2 -top-2 opacity-0 group-hover/attachment:opacity-100 focus:opacity-100"
        aria-label="Delete attachment"
        @click.prevent="emit('delete', a)"
      />
    </div>

    <!-- documents and deleted files -->
    <div v-if="others.length" class="flex flex-wrap gap-2">
      <template v-for="a in others" :key="a.id">
        <span v-if="a.deleted_at" class="flex items-center gap-1 rounded border border-dashed border-default px-2 py-1 text-xs italic text-muted">
          <UIcon name="i-lucide-trash-2" class="size-3" /> Attachment deleted
        </span>
        <div v-else class="group/attachment relative">
          <a
            :href="urls[a.id]"
            class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm hover:bg-elevated"
          >
            <UIcon :name="fileIcon(a)" class="size-5 text-muted" />
            <span class="max-w-60 truncate">{{ a.file_name }}</span>
            <span class="text-xs text-muted">{{ formatBytes(a.size_bytes) }}</span>
            <UIcon name="i-lucide-download" class="size-3.5 text-muted" />
          </a>
          <UButton
            v-if="canDelete"
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="solid"
            class="absolute -right-2 -top-2 opacity-0 group-hover/attachment:opacity-100 focus:opacity-100"
            aria-label="Delete attachment"
            @click.prevent="emit('delete', a)"
          />
        </div>
      </template>
    </div>

    <MediaViewer
      v-if="media.length"
      v-model:open="viewerOpen"
      v-model:index="viewerIndex"
      :items="viewerItems"
      :caption="caption"
      :sender="sender"
      :sent-at="sentAt"
    />
  </div>
</template>
