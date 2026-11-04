<script setup lang="ts">
import type { Database } from '~/types/database.types'

type Message = Pick<Database['public']['Tables']['messages']['Row'], 'id' | 'channel_id' | 'user_id' | 'body' | 'created_at' | 'edited_at'>

const MESSAGE_COLUMNS = 'id, channel_id, user_id, body, created_at, edited_at'
const PAGE_SIZE = 100

const route = useRoute()
const supabase = useSupabaseClient<Database>()
const chat = useChatStore()
const toast = useToast()

const channelId = computed(() => String(route.params.id))
const channel = computed(() => chat.channels.find((c) => c.id === channelId.value))

const messages = ref<Message[]>([])
const draft = ref('')
const sending = ref(false)
const loading = ref(true)
const scroller = ref<HTMLElement | null>(null)
const membersOpen = ref(false)

function sortMessages() {
  messages.value.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

async function loadMessages(id: string) {
  loading.value = true
  messages.value = []
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', id)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
  if (id !== channelId.value) return // user already moved on
  loading.value = false
  if (error) {
    toast.add({ title: 'Could not load messages', description: error.message, color: 'error' })
    return
  }
  messages.value = data.reverse()
  await scrollToBottom()
}

let realtime: ReturnType<typeof supabase.channel> | null = null

function subscribe(id: string) {
  unsubscribe()
  realtime = supabase
    .channel(`messages:${id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` }, (payload) => {
      const m = payload.new as Message
      if (messages.value.some((x) => x.id === m.id)) return // already added by our own send
      messages.value.push(m)
      sortMessages()
      scrollToBottom()
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` }, (payload) => {
      const m = payload.new as Message
      const i = messages.value.findIndex((x) => x.id === m.id)
      if (i >= 0) messages.value[i] = m
    })
    // DELETE events only carry the primary key, so they cannot be filtered by channel.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
      const oldId = (payload.old as { id?: string }).id
      messages.value = messages.value.filter((x) => x.id !== oldId)
    })
    .subscribe()
}

function unsubscribe() {
  if (realtime) supabase.removeChannel(realtime)
  realtime = null
}

watch(
  channelId,
  (id) => {
    loadMessages(id)
    subscribe(id)
  },
  { immediate: true },
)
onBeforeUnmount(unsubscribe)

async function send() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId.value, body })
    .select(MESSAGE_COLUMNS)
    .single()
  sending.value = false
  if (error) {
    toast.add({ title: 'Message not sent', description: error.message, color: 'error' })
    return
  }
  draft.value = ''
  if (!messages.value.some((x) => x.id === data.id)) {
    messages.value.push(data)
    sortMessages()
  }
  scrollToBottom()
}

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) return // newline
  e.preventDefault()
  send()
}

async function remove(m: Message) {
  const { error } = await supabase.from('messages').delete().eq('id', m.id)
  if (error) toast.add({ title: 'Could not delete', description: error.message, color: 'error' })
  else messages.value = messages.value.filter((x) => x.id !== m.id)
}

const time = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b border-default px-4 py-2">
      <span class="font-medium">{{ channel ? chat.channelTitle(channel) : '…' }}</span>
      <UButton v-if="channel?.kind === 'project'" icon="i-lucide-users" size="sm" color="neutral" variant="ghost" @click="membersOpen = true">
        Members
      </UButton>
    </div>

    <UModal v-if="channel?.kind === 'project'" v-model:open="membersOpen" title="Project members">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          {{ channel.is_private
            ? 'Private project: only these people, the client\'s managers and admins can see it.'
            : 'Everyone in the client can see this project. Add people here to make them project managers or to track who is on it.' }}
        </p>
        <MembersEditor kind="channel" :id="channel.id" :can-manage="chat.canManageChannel(channel)" />
      </template>
    </UModal>

    <div v-if="chat.loaded && !channel" class="p-6 text-muted">This conversation doesn't exist or you don't have access.</div>

    <template v-else>
      <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p v-if="loading" class="text-muted">Loading…</p>
        <p v-else-if="!messages.length" class="text-muted">No messages yet. Say hello!</p>
        <div v-for="m in messages" :key="m.id" class="group">
          <div class="flex items-baseline gap-2">
            <span class="font-semibold">{{ chat.userName(m.user_id) }}</span>
            <span class="text-xs text-muted">{{ time(m.created_at) }}<span v-if="m.edited_at"> (edited)</span></span>
            <UButton
              v-if="m.user_id === chat.myId"
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              class="ml-auto opacity-0 group-hover:opacity-100"
              aria-label="Delete message"
              @click="remove(m)"
            />
          </div>
          <p class="whitespace-pre-wrap break-words">{{ m.body }}</p>
        </div>
      </div>

      <form class="border-t border-default p-3" @submit.prevent="send">
        <UTextarea
          v-model="draft"
          :rows="2"
          autoresize
          :maxrows="8"
          maxlength="4000"
          placeholder="Message (Enter to send, Shift+Enter for a new line)"
          class="w-full"
          @keydown.enter="onEnter"
        />
      </form>
    </template>
  </div>
</template>
