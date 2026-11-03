<script setup lang="ts">
definePageMeta({ layout: 'blank' })

// Landing page for invite / magic-link redirects. The Supabase module
// processes the token; once a session exists, move on.
const user = useSupabaseUser()
watch(user, (u) => { if (u) navigateTo('/') }, { immediate: true })
</script>

<template>
  <div class="flex min-h-screen items-center justify-center text-muted">Signing you in…</div>
</template>
