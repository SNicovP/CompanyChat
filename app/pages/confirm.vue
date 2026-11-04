<script setup lang="ts">
definePageMeta({ layout: 'blank' })

// Landing page for invite / magic-link redirects. The Supabase module
// processes the token; once a session exists, move on.
// Invites arrive with ?next=set-password so new people choose a password first.
const user = useSupabaseUser()
const route = useRoute()
watch(
  user,
  (u) => { if (u) navigateTo(route.query.next === 'set-password' ? '/set-password' : '/') },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-screen items-center justify-center text-muted">Signing you in…</div>
</template>
