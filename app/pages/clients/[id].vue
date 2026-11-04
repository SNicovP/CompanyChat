<script setup lang="ts">
const route = useRoute()
const chat = useChatStore()

const clientId = computed(() => String(route.params.id))
const client = computed(() => chat.clients.find((c) => c.id === clientId.value))
const projects = computed(() => chat.projectsByClient[clientId.value] ?? [])
</script>

<template>
  <div class="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-6">
    <p v-if="chat.loaded && !client" class="text-muted">This client doesn't exist or you don't have access.</p>
    <template v-else-if="client">
      <h1 class="text-2xl font-semibold">{{ client.name }}</h1>

      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Projects</h2>
        <p v-if="!projects.length" class="text-sm text-muted">No projects you can see yet.</p>
        <ul>
          <li v-for="p in projects" :key="p.id">
            <NuxtLink :to="`/c/${p.id}`" class="flex items-center gap-1 rounded px-2 py-1 hover:bg-elevated">
              <UIcon v-if="p.is_private" name="i-lucide-lock" class="size-3" />
              {{ p.name }}
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase text-muted">Client members</h2>
        <p class="mb-2 text-sm text-muted">Members can see this client's public projects. Managers add and remove people and create projects.</p>
        <MembersEditor kind="client" :id="clientId" :can-manage="chat.canManageClient(clientId)" />
      </section>
    </template>
  </div>
</template>
