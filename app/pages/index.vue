<script setup lang="ts">
const store = useProfileStore()
</script>

<template>
  <div class="flex h-full items-center justify-center p-8">
    <div class="text-center">
      <h1 class="text-2xl font-semibold">Welcome<span v-if="store.profile">, {{ store.profile.display_name }}</span></h1>
      <p class="mt-2 text-muted">Pick a project or a conversation from the menu to get started.</p>
    </div>
  </div>
</template>
