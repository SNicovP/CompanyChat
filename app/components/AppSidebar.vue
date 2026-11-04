<script setup lang="ts">
const chat = useChatStore()
const profile = useProfileStore()
const route = useRoute()
const toast = useToast()

const newClientOpen = ref(false)
const newProjectFor = ref<string | null>(null)
const newProjectOpen = ref(false)
const dmOpen = ref(false)

const activeId = computed(() => String(route.params.id ?? ''))

function fail(title: string, e: unknown) {
  toast.add({ title, description: errorMessage(e), color: 'error' })
}

async function onNewClient(name: string) {
  try {
    await chat.createClient(name)
    newClientOpen.value = false
  } catch (e) {
    fail('Could not create client', e)
  }
}

function openNewProject(clientId: string) {
  newProjectFor.value = clientId
  newProjectOpen.value = true
}

async function onNewProject(name: string, isPrivate: boolean) {
  if (!newProjectFor.value) return
  try {
    const id = await chat.createProject(newProjectFor.value, name, isPrivate)
    newProjectOpen.value = false
    await navigateTo(`/c/${id}`)
  } catch (e) {
    fail('Could not create project', e)
  }
}

async function openDm(userId: string) {
  try {
    const id = await chat.startDm(userId)
    dmOpen.value = false
    await navigateTo(`/c/${id}`)
  } catch (e) {
    fail('Could not open conversation', e)
  }
}

const people = computed(() => chat.activePeople.filter((u) => u.id !== chat.myId))

// Admins add clients; admins and that client's managers add projects; RLS is the real gate, this just hides the button.
const canCreateClient = computed(() => profile.isAdmin)
const canCreateProject = (clientId: string) => chat.canManageClient(clientId)
</script>

<template>
  <aside class="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-default p-3">
    <section>
      <div class="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted">
        Clients
        <UButton v-if="canCreateClient" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New client" @click="newClientOpen = true" />
      </div>
      <p v-if="chat.loaded && !chat.clients.length" class="px-2 text-sm text-muted">No clients yet.</p>
      <div v-for="client in chat.clients" :key="client.id" class="mb-2">
        <div class="flex items-center justify-between px-2 text-sm font-medium">
          <NuxtLink :to="`/clients/${client.id}`" class="hover:underline">{{ client.name }}</NuxtLink>
          <UButton v-if="canCreateProject(client.id)" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New project" @click="openNewProject(client.id)" />
        </div>
        <NuxtLink
          v-for="p in chat.projectsByClient[client.id] ?? []"
          :key="p.id"
          :to="`/c/${p.id}`"
          class="flex items-center gap-1 rounded px-4 py-1 text-sm hover:bg-elevated"
          :class="{ 'bg-elevated font-medium': activeId === p.id, 'font-semibold': chat.unread[p.id] }"
        >
          <UIcon v-if="p.is_private" name="i-lucide-lock" class="size-3" />
          {{ p.name }}
          <UBadge v-if="chat.unread[p.id]" size="sm" class="ml-auto">{{ chat.unread[p.id] }}</UBadge>
        </NuxtLink>
      </div>
    </section>

    <section>
      <div class="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted">
        Direct messages
        <UButton icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New message" @click="dmOpen = true" />
      </div>
      <NuxtLink
        v-for="dm in chat.dms"
        :key="dm.id"
        :to="`/c/${dm.id}`"
        class="flex items-center gap-2 rounded px-4 py-1 text-sm hover:bg-elevated"
        :class="{ 'bg-elevated font-medium': activeId === dm.id, 'font-semibold': chat.unread[dm.id] }"
      >
        <StatusDot :status="chat.displayStatus(chat.otherUser(dm)?.id)" size="sm" />
        {{ chat.channelTitle(dm) }}
        <UBadge v-if="chat.unread[dm.id]" size="sm" class="ml-auto">{{ chat.unread[dm.id] }}</UBadge>
      </NuxtLink>
    </section>

    <NameModal v-model:open="newClientOpen" title="New client" label="Client name" @submit="onNewClient" />
    <NameModal v-model:open="newProjectOpen" title="New project" label="Project name" with-private @submit="onNewProject" />

    <UModal v-model:open="dmOpen" title="New message">
      <template #body>
        <p v-if="!people.length" class="text-sm text-muted">No one else has joined yet.</p>
        <button
          v-for="u in people"
          :key="u.id"
          type="button"
          class="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-elevated"
          @click="openDm(u.id)"
        >
          <StatusDot :status="chat.displayStatus(u.id)" />
          {{ u.display_name }}
        </button>
      </template>
    </UModal>
  </aside>
</template>
