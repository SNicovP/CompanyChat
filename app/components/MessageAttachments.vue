<script setup lang="ts">
export interface AttachmentView {
  id: string
  path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
}

const props = defineProps<{ attachments: AttachmentView[] }>()
const { urls, ensure } = useAttachmentUrls()

watch(() => props.attachments.map((a) => a.path).join('|'), () => ensure(props.attachments), { immediate: true })
</script>

<template>
  <div class="mt-1 flex flex-wrap gap-2">
    <template v-for="a in attachments" :key="a.id">
      <a v-if="isInlineImage(a.mime_type)" :href="urls[a.path]" target="_blank" rel="noopener" class="block">
        <img v-if="urls[a.path]" :src="urls[a.path]" :alt="a.file_name" class="max-h-64 max-w-full rounded border border-default" />
        <span v-else class="text-sm text-muted">{{ a.file_name }}…</span>
      </a>
      <a
        v-else
        :href="urls[a.path]"
        class="flex items-center gap-2 rounded border border-default px-3 py-2 text-sm hover:bg-elevated"
      >
        <UIcon name="i-lucide-file" class="size-4" />
        <span>{{ a.file_name }}</span>
        <span class="text-xs text-muted">{{ formatBytes(a.size_bytes) }}</span>
      </a>
    </template>
  </div>
</template>
