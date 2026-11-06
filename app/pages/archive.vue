<script setup lang="ts">
const chat = useChatStore()
const profile = useProfileStore()
const toast = useToast()
const busy = ref<string | null>(null)

async function restore(kind: 'client' | 'project', id: string) {
  busy.value = id
  try {
    if (kind === 'client') await chat.setClientArchived(id, false)
    else await chat.setProjectArchived(id, false)
    toast.add({ title: 'Restored' })
  } catch (e) {
    toast.add({ title: 'Could not restore', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-6">
    <h1 class="text-2xl font-semibold">Archived</h1>
    <p class="text-sm text-muted">Archived clients and projects are hidden from everyone, but nothing is deleted. Restore one to bring back its messages.</p>
    <p v-if="!chat.archivedClients.length && !chat.archivedProjects.length" class="text-muted">Nothing is archived.</p>

    <section v-if="chat.archivedClients.length">
      <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Clients</h2>
      <ul class="divide-y divide-accented rounded-lg border border-accented">
        <li v-for="c in chat.archivedClients" :key="c.id" class="flex items-center justify-between gap-3 px-3 py-2">
          <span class="flex items-center gap-2"><UIcon name="i-lucide-building-2" class="size-4 text-muted" />{{ c.name }}</span>
          <UButton v-if="profile.isAdmin" size="sm" color="neutral" variant="soft" :loading="busy === c.id" @click="restore('client', c.id)">Restore</UButton>
        </li>
      </ul>
    </section>

    <section v-if="chat.archivedProjects.length">
      <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Projects</h2>
      <ul class="divide-y divide-accented rounded-lg border border-accented">
        <li v-for="p in chat.archivedProjects" :key="p.id" class="flex items-center justify-between gap-3 px-3 py-2">
          <span class="flex min-w-0 items-center gap-2"><UIcon name="i-lucide-hash" class="size-4 shrink-0 text-muted" /><span class="truncate">{{ p.name }}</span><span class="truncate text-sm text-muted">in {{ p.clientName }}</span></span>
          <UButton size="sm" color="neutral" variant="soft" :loading="busy === p.id" @click="restore('project', p.id)">Restore</UButton>
        </li>
      </ul>
    </section>
  </div>
</template>
