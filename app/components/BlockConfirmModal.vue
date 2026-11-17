<script setup lang="ts">
// "Block X?" with the warning that blocking is not private. Opened from the person menu (blocks.confirming).
const blocks = useBlocksStore()
const chat = useChatStore()

const open = computed({
  get: () => !!blocks.confirming,
  set: (v) => { if (!v) blocks.confirming = null },
})
const name = computed(() => chat.userName(blocks.confirming))

async function confirm() {
  const id = blocks.confirming
  blocks.confirming = null
  if (id) await blocks.block(id)
}
</script>

<template>
  <UModal v-model:open="open" :title="`Block ${name}?`">
    <template #body>
      <div class="space-y-3 text-sm">
        <p>Neither of you will be able to message or call the other directly. Your old messages stay.</p>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-eye"
          title="Blocking is not private"
          :description="`${name} is told that you blocked them, and sees it in your conversation. You still both see each other in shared projects.`"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
        <UButton color="error" icon="i-lucide-ban" @click="confirm">Block</UButton>
      </div>
    </template>
  </UModal>
</template>
