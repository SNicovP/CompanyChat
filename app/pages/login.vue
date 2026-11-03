<script setup lang="ts">
definePageMeta({ layout: 'blank' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

watch(user, (u) => { if (u) navigateTo('/') }, { immediate: true })

async function signIn() {
  loading.value = true
  errorMessage.value = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (error) errorMessage.value = error.message
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold">Sign in to CompanyChat</h1>
      </template>
      <form class="space-y-4" @submit.prevent="signIn">
        <UFormField label="Email">
          <UInput v-model="email" type="email" autocomplete="email" required class="w-full" />
        </UFormField>
        <UFormField label="Password">
          <UInput v-model="password" type="password" autocomplete="current-password" required class="w-full" />
        </UFormField>
        <UAlert v-if="errorMessage" color="error" variant="subtle" :description="errorMessage" />
        <UButton type="submit" block :loading="loading">Sign in</UButton>
      </form>
      <p class="mt-4 text-sm text-muted">Accounts are invite-only. Ask an admin for access.</p>
    </UCard>
  </div>
</template>
