<script setup lang="ts">
// Small modal asking for a name (new client / new project).
const props = defineProps<{ title: string; label: string; withPrivate?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [name: string, isPrivate: boolean] }>()

const name = ref('')
const isPrivate = ref(false)

watch(open, (v) => {
  if (v) {
    name.value = ''
    isPrivate.value = false
  }
})

function submit() {
  if (!name.value.trim()) return
  emit('submit', name.value, isPrivate.value)
}
</script>

<template>
  <UModal v-model:open="open" :title="props.title">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField :label="props.label">
          <UInput v-model="name" autofocus class="w-full" />
        </UFormField>
        <UCheckbox v-if="props.withPrivate" v-model="isPrivate" label="Private (invite only)" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" :disabled="!name.trim()">Create</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
