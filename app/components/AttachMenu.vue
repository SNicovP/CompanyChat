<script setup lang="ts">
// The composer's "+" button: a small grid of things to send (like WhatsApp's attachment sheet).
export type AttachAction = 'file' | 'gallery' | 'camera' | 'video' | 'voice' | 'location' | 'contact'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ pick: [action: AttachAction] }>()
const open = ref(false)

// Full class names so Tailwind includes them.
const items: { action: AttachAction; label: string; icon: string; tint: string }[] = [
  { action: 'file', label: 'Document', icon: 'i-lucide-paperclip', tint: 'bg-indigo-500' },
  { action: 'gallery', label: 'Photos & videos', icon: 'i-lucide-images', tint: 'bg-sky-500' },
  { action: 'camera', label: 'Camera', icon: 'i-lucide-camera', tint: 'bg-rose-500' },
  { action: 'video', label: 'Video', icon: 'i-lucide-video', tint: 'bg-fuchsia-500' },
  { action: 'voice', label: 'Voice note', icon: 'i-lucide-mic', tint: 'bg-orange-500' },
  { action: 'location', label: 'Location', icon: 'i-lucide-map-pin', tint: 'bg-emerald-500' },
  { action: 'contact', label: 'Contact', icon: 'i-lucide-contact', tint: 'bg-teal-500' },
]

function choose(action: AttachAction) {
  open.value = false
  emit('pick', action)
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ side: 'top', align: 'start', sideOffset: 8 }">
    <UButton
      color="neutral"
      variant="ghost"
      :disabled="disabled"
      aria-label="Attach"
      title="Attach a file, photo, video, voice note, location or contact"
      class="gap-0.5 px-1.5"
    >
      <UIcon name="i-lucide-plus" class="size-5 transition-transform duration-200" :class="open ? 'rotate-45' : ''" />
      <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
    </UButton>
    <template #content>
      <div class="grid grid-cols-4 gap-1 p-2" role="menu" aria-label="Attach">
        <button
          v-for="i in items"
          :key="i.action"
          type="button"
          role="menuitem"
          class="flex w-20 flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-xs text-toned outline-none hover:bg-elevated focus-visible:bg-elevated"
          @click="choose(i.action)"
        >
          <span class="flex size-11 items-center justify-center rounded-full text-white shadow-sm" :class="i.tint">
            <UIcon :name="i.icon" class="size-5" />
          </span>
          <span class="text-center leading-tight">{{ i.label }}</span>
        </button>
      </div>
    </template>
  </UPopover>
</template>
