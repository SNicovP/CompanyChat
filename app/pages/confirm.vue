<script setup lang="ts">
definePageMeta({ layout: 'blank' })

// Landing page for invite / password-reset / magic-link redirects.
// Invites arrive with ?next=set-password so new people choose a password first.
//
// Links created by the server (invites, password emails sent by an admin) put the session in the URL
// hash (#access_token=...&refresh_token=...). The app's Supabase client uses the PKCE flow, which
// refuses that format and silently ends up with no session (so you land on the login page). We read
// the tokens ourselves and sign in with them. Links that carry a PKCE ?code= are still handled by the client.
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()
const failed = ref('')

const destination = () => (route.query.next === 'set-password' ? '/set-password' : '/')

onMounted(async () => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
    history.replaceState(null, '', window.location.pathname + window.location.search) // keep tokens out of history
    if (error) failed.value = error.message
    else await navigateTo(destination(), { replace: true })
    return
  }
  const linkError = params.get('error_description')
  if (linkError) failed.value = linkError.replace(/\+/g, ' ')
})

watch(
  user,
  (u) => { if (u) navigateTo(destination()) },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4 text-center text-muted">
    <div v-if="failed" class="space-y-3">
      <p>This link did not work: {{ failed }}</p>
      <p class="text-sm">It may have expired or already been used. Ask an admin to send you a new one.</p>
      <UButton to="/login" color="neutral" variant="outline">Go to sign in</UButton>
    </div>
    <span v-else>Signing you in…</span>
  </div>
</template>
