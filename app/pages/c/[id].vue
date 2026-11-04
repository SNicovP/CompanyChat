<script setup lang="ts">
import type { Database } from '~/types/database.types'

type Attachment = Pick<Database['public']['Tables']['message_attachments']['Row'], 'id' | 'message_id' | 'path' | 'file_name' | 'mime_type' | 'size_bytes'>
type Message = Pick<Database['public']['Tables']['messages']['Row'], 'id' | 'channel_id' | 'user_id' | 'body' | 'created_at' | 'edited_at'> & {
  message_attachments?: Attachment[]
}

const ATTACHMENT_COLUMNS = 'id, message_id, path, file_name, mime_type, size_bytes'
const MESSAGE_COLUMNS = `id, channel_id, user_id, body, created_at, edited_at, message_attachments(${ATTACHMENT_COLUMNS})`
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
const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

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
      // the event carries only message columns, so keep the attachments we already have
      if (i >= 0) messages.value[i] = { ...m, message_attachments: messages.value[i]!.message_attachments }
    })
    // Attachment rows are written just after their message, so they arrive as separate events.
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments', filter: `channel_id=eq.${id}` }, (payload) => {
      const a = payload.new as Attachment
      const m = messages.value.find((x) => x.id === a.message_id)
      if (!m) return
      const list = m.message_attachments ?? []
      if (!list.some((x) => x.id === a.id)) m.message_attachments = [...list, a]
      scrollToBottom()
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
    chat.setActive(id)
    loadMessages(id)
    subscribe(id)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  unsubscribe()
  chat.setActive(null)
})

function addFiles(list: FileList | File[] | null | undefined) {
  for (const file of Array.from(list ?? [])) {
    const problem = validateFile(file)
    if (problem) {
      toast.add({ title: 'File not added', description: problem, color: 'warning' })
      continue
    }
    if (files.value.length >= MAX_FILES_PER_MESSAGE) {
      toast.add({ title: 'Too many files', description: `You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.`, color: 'warning' })
      break
    }
    files.value.push(file)
  }
}

function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  addFiles(input.files)
  input.value = ''
}

function onPaste(e: ClipboardEvent) {
  if (e.clipboardData?.files.length) {
    e.preventDefault()
    addFiles(e.clipboardData.files)
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  addFiles(e.dataTransfer?.files)
}

/** Upload the files of a just-created message; returns the attachment rows. Throws on any failure. */
async function uploadAttachments(messageId: string, picked: File[]): Promise<Attachment[]> {
  const bucket = supabase.storage.from('attachments')
  const uploaded: string[] = []
  try {
    const rows: Database['public']['Tables']['message_attachments']['Insert'][] = []
    for (const [i, file] of picked.entries()) {
      const path = `${channelId.value}/${messageId}/${i}_${safeFileName(file.name)}`
      const { error } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) throw error
      uploaded.push(path)
      rows.push({
        message_id: messageId,
        channel_id: channelId.value,
        path,
        file_name: file.name.slice(0, 255),
        mime_type: file.type || null,
        size_bytes: file.size,
      })
    }
    const { data, error } = await supabase.from('message_attachments').insert(rows).select(ATTACHMENT_COLUMNS)
    if (error) throw error
    return data
  } catch (e) {
    if (uploaded.length) await bucket.remove(uploaded)
    throw e
  }
}

async function send() {
  const body = draft.value.trim()
  const picked = [...files.value]
  if ((!body && !picked.length) || sending.value) return
  sending.value = true
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId.value, body })
    .select(MESSAGE_COLUMNS)
    .single()
  if (error) {
    sending.value = false
    toast.add({ title: 'Message not sent', description: errorMessage(error), color: 'error' })
    return
  }

  let attachments: Attachment[] = []
  if (picked.length) {
    try {
      attachments = await uploadAttachments(data.id, picked)
    } catch (e) {
      await supabase.from('messages').delete().eq('id', data.id) // don't leave a half-sent message behind
      messages.value = messages.value.filter((x) => x.id !== data.id)
      sending.value = false
      toast.add({ title: 'Files not sent', description: errorMessage(e), color: 'error' })
      return // keep the draft and files so the user can retry
    }
  }

  sending.value = false
  draft.value = ''
  files.value = []
  const existing = messages.value.find((x) => x.id === data.id)
  if (existing) existing.message_attachments = attachments // realtime got there first
  else {
    messages.value.push({ ...data, message_attachments: attachments })
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
  const paths = (m.message_attachments ?? []).map((a) => a.path)
  if (paths.length) await supabase.storage.from('attachments').remove(paths) // best effort
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
            <StatusDot :status="chat.displayStatus(m.user_id)" size="sm" class="self-center" />
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
          <p v-if="m.body" class="whitespace-pre-wrap break-words">{{ m.body }}</p>
          <MessageAttachments v-if="m.message_attachments?.length" :attachments="m.message_attachments" />
        </div>
      </div>

      <form
        class="border-t border-default p-3"
        :class="{ 'bg-elevated': dragging }"
        @submit.prevent="send"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <div v-if="files.length" class="mb-2 flex flex-wrap gap-2">
          <UBadge v-for="(f, i) in files" :key="`${f.name}-${i}`" color="neutral" variant="subtle" class="gap-1">
            {{ f.name }} <span class="text-muted">{{ formatBytes(f.size) }}</span>
            <button type="button" class="ml-1" aria-label="Remove file" @click="files.splice(i, 1)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </UBadge>
        </div>
        <div class="flex items-end gap-2">
          <input ref="fileInput" type="file" multiple class="hidden" @change="onPickFiles" />
          <UButton icon="i-lucide-paperclip" color="neutral" variant="ghost" aria-label="Attach files" @click="fileInput?.click()" />
          <UTextarea
            v-model="draft"
            :rows="2"
            autoresize
            :maxrows="8"
            maxlength="4000"
            placeholder="Message (Enter to send, Shift+Enter for a new line, paste or drop files)"
            class="flex-1"
            :disabled="sending"
            @keydown.enter="onEnter"
            @paste="onPaste"
          />
        </div>
      </form>
    </template>
  </div>
</template>
