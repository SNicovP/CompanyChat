<script setup lang="ts">
const chat = useChatStore()
const profile = useProfileStore()
const route = useRoute()
const toast = useToast()

const newClientOpen = ref(false)
const newProjectFor = ref<string | null>(null)
const newProjectOpen = ref(false)
const dmOpen = ref(false)
const searchOpen = ref(false)

// Cmd/Ctrl+K opens search from anywhere.
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

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
  <aside class="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-r border-accented bg-muted p-3">
    <UButton icon="i-lucide-search" color="neutral" variant="outline" block class="justify-start" @click="searchOpen = true">
      <span class="text-muted">Search messages</span>
      <UKbd class="ml-auto" value="meta" /><UKbd value="K" />
    </UButton>

    <section>
      <div class="flex items-center justify-between rounded-md bg-accented/50 py-1 pl-2.5 pr-1 text-xs font-bold uppercase tracking-wider text-highlighted">
        <span class="flex items-center gap-2"><UIcon name="i-lucide-briefcase" class="size-4 text-primary" />Clients &amp; projects</span>
        <UButton v-if="canCreateClient" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New client" @click="newClientOpen = true" />
      </div>
      <p v-if="chat.loaded && !chat.clients.length" class="px-2 pt-2 text-sm text-muted">No clients yet.</p>
      <div v-for="client in chat.clients" :key="client.id" class="mt-3">
        <div class="flex items-center gap-2 px-2">
          <UIcon name="i-lucide-building-2" class="size-4 shrink-0 text-primary" />
          <NuxtLink :to="`/clients/${client.id}`" class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted hover:underline">{{ client.name }}</NuxtLink>
          <UButton v-if="canCreateProject(client.id)" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New project" @click="openNewProject(client.id)" />
        </div>
        <div class="ml-4 mt-1 space-y-0.5 border-l border-accented pl-2">
          <NuxtLink
            v-for="p in chat.projectsByClient[client.id] ?? []"
            :key="p.id"
            :to="`/c/${p.id}`"
            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accented/60"
            :class="activeId === p.id ? 'bg-primary/15 font-medium text-primary' : chat.unread[p.id] ? 'font-semibold text-highlighted' : 'text-muted hover:text-highlighted'"
          >
            <UIcon :name="p.is_private ? 'i-lucide-lock' : 'i-lucide-hash'" class="size-3.5 shrink-0" />
            <span class="truncate">{{ p.name }}</span>
            <UIcon v-if="chat.watchedChannelIds.includes(p.id)" name="i-lucide-bell-ring" class="size-3 shrink-0 opacity-70" title="Notifying for every message" />
            <span class="ml-auto flex shrink-0 gap-1">
              <UBadge v-if="chat.mentions[p.id]" size="sm" color="error" :title="`${chat.mentions[p.id]} mention(s) of you`">@{{ chat.mentions[p.id] }}</UBadge>
              <UBadge v-if="chat.unread[p.id]" size="sm">{{ chat.unread[p.id] }}</UBadge>
            </span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-center justify-between rounded-md bg-accented/50 py-1 pl-2.5 pr-1 text-xs font-bold uppercase tracking-wider text-highlighted">
        <span class="flex items-center gap-2"><UIcon name="i-lucide-messages-square" class="size-4 text-primary" />Direct messages</span>
        <UButton icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" aria-label="New message" @click="dmOpen = true" />
      </div>
      <div class="mt-2 space-y-0.5">
        <NuxtLink
          v-for="dm in chat.dms"
          :key="dm.id"
          :to="`/c/${dm.id}`"
          class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accented/60"
          :class="activeId === dm.id ? 'bg-primary/15 font-medium text-primary' : chat.unread[dm.id] ? 'font-semibold text-highlighted' : 'text-muted hover:text-highlighted'"
        >
          <UserAvatar :name="chat.channelTitle(dm)" :status="chat.displayStatus(chat.otherUser(dm)?.id)" size="sm" />
          <span class="truncate">{{ chat.channelTitle(dm) }}</span>
          <span class="ml-auto flex shrink-0 gap-1">
            <UBadge v-if="chat.mentions[dm.id]" size="sm" color="error">@{{ chat.mentions[dm.id] }}</UBadge>
            <UBadge v-if="chat.unread[dm.id]" size="sm">{{ chat.unread[dm.id] }}</UBadge>
          </span>
        </NuxtLink>
        <p v-if="!chat.dms.length" class="px-2 text-sm text-muted">No conversations yet.</p>
      </div>
    </section>

    <SearchModal v-model:open="searchOpen" />
    <NameModal v-model:open="newClientOpen" title="New client" label="Client name" @submit="onNewClient" />
    <NameModal v-model:open="newProjectOpen" title="New project" label="Project name" with-private @submit="onNewProject" />

    <UModal v-model:open="dmOpen" title="New message">
      <template #body>
        <p v-if="!people.length" class="text-sm text-muted">No one else has joined yet.</p>
        <button
          v-for="u in people"
          :key="u.id"
          type="button"
          class="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-elevated"
          @click="openDm(u.id)"
        >
          <UserAvatar :name="u.display_name" :status="chat.displayStatus(u.id)" />
          {{ u.display_name }}
        </button>
      </template>
    </UModal>
  </aside>
</template>
