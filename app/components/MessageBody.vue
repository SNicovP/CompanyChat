<script setup lang="ts">
const props = defineProps<{ body: string }>()
const chat = useChatStore()

const segments = computed(() => splitMentions(props.body))
</script>

<template>
  <p class="whitespace-pre-wrap break-words">
    <template v-for="(s, i) in segments" :key="i">
      <span
        v-if="s.type === 'mention'"
        class="rounded px-1 font-medium"
        :class="s.userId === chat.myId ? 'bg-primary/25 text-primary' : 'bg-elevated'"
      >@{{ chat.userName(s.userId) }}</span>
      <span v-else-if="s.type === 'channel'" class="rounded bg-primary/25 px-1 font-medium text-primary">@channel</span>
      <template v-else>{{ s.text }}</template>
    </template>
  </p>
</template>
