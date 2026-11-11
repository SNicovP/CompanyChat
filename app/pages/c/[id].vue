<script setup lang="ts">
import type { Database } from '~/types/database.types'

type Attachment = Pick<Database['public']['Tables']['message_attachments']['Row'], 'id' | 'message_id' | 'path' | 'file_name' | 'mime_type' | 'size_bytes' | 'deleted_at'>
type Message = Pick<Database['public']['Tables']['messages']['Row'], 'id' | 'channel_id' | 'user_id' | 'body' | 'created_at' | 'edited_at' | 'reply_to'> & {
  message_attachments?: Attachment[]
  pending?: boolean // shown before the server has confirmed it
}

const ATTACHMENT_COLUMNS = 'id, message_id, path, file_name, mime_type, size_bytes, deleted_at'
const MESSAGE_COLUMNS = `id, channel_id, user_id, body, created_at, edited_at, reply_to, message_attachments(${ATTACHMENT_COLUMNS})`
const PAGE_SIZE = 100

const route = useRoute()
const supabase = useSupabaseClient<Database>()
const chat = useChatStore()
const toast = useToast()

const channelId = computed(() => String(route.params.id))
const channel = computed(() => chat.channels.find((c) => c.id === channelId.value))

const clientName = computed(() => chat.clients.find((c) => c.id === channel.value?.client_id)?.name ?? '')

const messages = ref<Message[]>([])
const draft = ref('')
const loading = ref(true)
const scroller = ref<HTMLElement | null>(null)
const membersOpen = ref(false)
const watching = computed(() => chat.watchedChannelIds.includes(channelId.value))

async function toggleWatch() {
  try {
    await chat.setWatching(channelId.value, !watching.value)
  } catch (e) {
    toast.add({ title: 'Could not change notifications', description: errorMessage(e), color: 'error' })
  }
}
const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const editingId = ref<string | null>(null)
const editDraft = ref('')
const editMap = ref<Record<string, string>>({}) // name -> user id for mentions already in the edited message

// @mention picker in the composer
const mentionMap = ref<Record<string, string>>({}) // name -> user id for mentions picked in this draft
const picker = reactive({ open: false, start: 0, query: '', index: 0 })
let composerEl: HTMLTextAreaElement | null = null
// "@channel" (everyone who can see this channel) is offered first; it is pointless in a 1:1 DM.
const everyoneOption = { id: CHANNEL_MENTION, display_name: CHANNEL_MENTION }
const candidates = computed(() => {
  if (!picker.open) return []
  const people = filterPeople(chat.activePeople.filter((u) => u.id !== chat.myId), picker.query)
  const offerEveryone = channel.value?.kind !== 'dm' && CHANNEL_MENTION.startsWith(picker.query.toLowerCase())
  return offerEveryone ? [everyoneOption, ...people].slice(0, 6) : people
})

function sortMessages() {
  messages.value.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

// Replying (like WhatsApp): the composer quotes one message, and replies show that quote above their text.
const replyingTo = ref<Message | null>(null)
const composer = ref<{ textareaRef?: HTMLTextAreaElement | null } | null>(null)
type Quote = { user_id: string | null; body: string; hasFiles: boolean }
const quoteCache = ref<Record<string, Quote | null>>({}) // originals older than the loaded page

const quoteOf = (m: Message): Quote | null => {
  if (!m.reply_to) return null
  const local = messages.value.find((x) => x.id === m.reply_to)
  if (local) return { user_id: local.user_id, body: local.body, hasFiles: (local.message_attachments ?? []).some((a) => !a.deleted_at) }
  return quoteCache.value[m.reply_to] ?? null
}

const quoteText = (q: Quote) => {
  const text = tokensToDisplay(q.body, (id) => chat.userName(id)).text.trim()
  return text || (q.hasFiles ? 'Attachment' : '')
}

/** Fetch the originals of replies whose original is not in the loaded page. */
async function loadQuotes(list: Message[]) {
  const have = new Set(list.map((x) => x.id))
  const ids = [...new Set(list.map((x) => x.reply_to).filter((r): r is string => !!r && !have.has(r) && !(r in quoteCache.value)))]
  if (!ids.length) return
  const { data } = await supabase.from('messages').select('id, user_id, body, message_attachments(id, deleted_at)').in('id', ids)
  for (const row of data ?? []) {
    quoteCache.value[row.id] = { user_id: row.user_id, body: row.body, hasFiles: (row.message_attachments ?? []).some((a) => !a.deleted_at) }
  }
}

function startReply(m: Message) {
  replyingTo.value = m
  editingId.value = null
  nextTick(() => composer.value?.textareaRef?.focus())
}

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

async function loadMessages(id: string) {
  loading.value = true
  messages.value = []
  replyingTo.value = null
  quoteCache.value = {}
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
  loadQuotes(messages.value)
  const target = typeof route.query.m === 'string' ? route.query.m : null
  if (target) await jumpTo(target)
  else await scrollToBottom()
}

// Opened from search (?m=<message id>): show that message, scroll to it and flash it.
const highlightId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined

async function jumpTo(messageId: string) {
  const id = channelId.value
  if (!messages.value.some((x) => x.id === messageId)) {
    // Older than the latest page: load from that message onwards.
    const { data: target } = await supabase.from('messages').select('created_at').eq('id', messageId).eq('channel_id', id).maybeSingle()
    if (target) {
      const { data } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('channel_id', id)
        .gte('created_at', target.created_at)
        .order('created_at', { ascending: true })
        .limit(500)
      if (id !== channelId.value) return
      if (data?.some((x) => x.id === messageId)) {
        messages.value = data
        loadQuotes(data)
      }
    }
  }
  await nextTick()
  const el = scroller.value?.querySelector(`[data-message-id="${messageId}"]`)
  if (el) {
    el.scrollIntoView({ block: 'center' })
    highlightId.value = messageId
    clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => (highlightId.value = null), 3000)
  } else {
    await scrollToBottom() // message no longer exists
  }
  await navigateTo({ path: route.path, query: {} }, { replace: true }) // so a refresh does not re-trigger
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
      loadQuotes([m])
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
    // Deleting one attachment flags its row, so everyone sees the "Attachment deleted" tag.
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_attachments', filter: `channel_id=eq.${id}` }, (payload) => {
      const a = payload.new as Attachment
      const m = messages.value.find((x) => x.id === a.message_id)
      const i = m?.message_attachments?.findIndex((x) => x.id === a.id) ?? -1
      if (m?.message_attachments && i >= 0) m.message_attachments[i] = { ...m.message_attachments[i]!, deleted_at: a.deleted_at }
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
// Searching from inside the channel you are already in only changes the query.
watch(
  () => route.query.m,
  (m) => {
    if (typeof m === 'string' && !loading.value) jumpTo(m)
  },
)
onBeforeUnmount(() => {
  clearTimeout(highlightTimer)
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
async function uploadAttachments(channel: string, messageId: string, picked: File[]): Promise<Attachment[]> {
  const bucket = supabase.storage.from('attachments')
  const uploaded: string[] = []
  try {
    const rows: Database['public']['Tables']['message_attachments']['Insert'][] = []
    for (const [i, file] of picked.entries()) {
      const path = `${channel}/${messageId}/${i}_${safeFileName(file.name)}`
      const { error } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) throw error
      uploaded.push(path)
      rows.push({
        message_id: messageId,
        channel_id: channel,
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

// Sends run one after another so messages keep the order they were typed in.
let sendQueue: Promise<void> = Promise.resolve()
let pendingSeq = 0

/**
 * Optimistic send: the composer clears and the message shows (dimmed) straight away;
 * the insert and any uploads run in the background and the row is swapped for the real one.
 */
function send() {
  const text = draft.value.trim()
  const map = { ...mentionMap.value }
  const body = displayToTokens(text, map)
  const picked = [...files.value]
  if (!body && !picked.length) return
  const replyTo = replyingTo.value && !replyingTo.value.pending ? replyingTo.value.id : null

  const id = channelId.value
  const tempId = `pending-${++pendingSeq}`
  messages.value.push({
    id: tempId,
    channel_id: id,
    user_id: chat.myId,
    body,
    created_at: new Date().toISOString(),
    edited_at: null,
    reply_to: replyTo,
    message_attachments: [],
    pending: true,
  })
  draft.value = ''
  replyingTo.value = null
  mentionMap.value = {}
  closePicker()
  files.value = []
  scrollToBottom()

  sendQueue = sendQueue.then(() => deliver(id, tempId, body, picked, text, map, replyTo))
}

async function deliver(id: string, tempId: string, body: string, picked: File[], text: string, map: Record<string, string>, replyTo: string | null) {
  const fail = (title: string, e: unknown) => {
    if (id === channelId.value) {
      messages.value = messages.value.filter((x) => x.id !== tempId)
      // Give the text and files back so the user can retry, unless they've started typing something else.
      if (!draft.value && !files.value.length) {
        draft.value = text
        mentionMap.value = map
        files.value = picked
        replyingTo.value = replyTo ? (messages.value.find((x) => x.id === replyTo) ?? null) : null
      }
    }
    toast.add({ title, description: errorMessage(e), color: 'error' })
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: id, body, reply_to: replyTo })
    .select(MESSAGE_COLUMNS)
    .single()
  if (error) return fail('Message not sent', error)

  let attachments: Attachment[] = []
  if (picked.length) {
    try {
      attachments = await uploadAttachments(id, data.id, picked)
    } catch (e) {
      await supabase.from('messages').delete().eq('id', data.id) // don't leave a half-sent message behind
      messages.value = messages.value.filter((x) => x.id !== data.id)
      return fail('Files not sent', e)
    }
  }

  if (id !== channelId.value) return // user moved on; the channel reloads from the server
  const real = { ...data, message_attachments: attachments }
  const existing = messages.value.find((x) => x.id === data.id)
  if (existing) {
    existing.message_attachments = attachments // realtime got there first
    messages.value = messages.value.filter((x) => x.id !== tempId)
  } else {
    const i = messages.value.findIndex((x) => x.id === tempId)
    if (i >= 0) messages.value[i] = real
    else messages.value.push(real)
  }
  sortMessages()
}

function startEdit(m: Message) {
  const { text, map } = tokensToDisplay(m.body, (id) => chat.userName(id))
  editingId.value = m.id
  editDraft.value = text
  editMap.value = map
}

function cancelEdit() {
  editingId.value = null
  editDraft.value = ''
}

async function saveEdit(m: Message) {
  const check = checkEdit(displayToTokens(editDraft.value, editMap.value), m.body, (m.message_attachments ?? []).some((a) => !a.deleted_at))
  if (check.action === 'cancel') return cancelEdit()
  if (check.action === 'reject') {
    toast.add({ title: 'Message not changed', description: check.reason, color: 'warning' })
    return
  }
  const { data, error } = await supabase
    .from('messages')
    .update({ body: check.body })
    .eq('id', m.id)
    .select('id, body, edited_at')
    .maybeSingle()
  if (error) {
    toast.add({ title: 'Could not save the edit', description: errorMessage(error), color: 'error' })
    return
  }
  if (!data) {
    toast.add({ title: 'Could not save the edit', description: 'You can no longer edit this message.', color: 'error' })
    return cancelEdit()
  }
  m.body = data.body
  m.edited_at = data.edited_at
  cancelEdit()
}

function onEditEnter(m: Message, e: KeyboardEvent) {
  if (e.shiftKey) return // newline
  e.preventDefault()
  saveEdit(m)
}

/** Up arrow in an empty composer edits your most recent message, like Slack. */
function onArrowUp(e: KeyboardEvent) {
  if (draft.value || files.value.length || editingId.value) return
  const mine = [...messages.value].reverse().find((m) => m.user_id === chat.myId && !m.pending)
  if (!mine) return
  e.preventDefault()
  startEdit(mine)
}

function closePicker() {
  picker.open = false
  picker.index = 0
}

/** Re-evaluate whether the caret is inside an @query; call on input, click and caret movement. */
function updatePicker(e: Event) {
  const el = e.target as HTMLTextAreaElement
  composerEl = el
  const found = findMentionQuery(el.value, el.selectionStart ?? 0)
  if (!found) return closePicker()
  if (!picker.open || found.query !== picker.query) picker.index = 0
  picker.open = true
  picker.start = found.start
  picker.query = found.query
}

function pick(person: { id: string; display_name: string }) {
  const el = composerEl
  if (!el) return
  const r = applyMention(draft.value, picker.start, el.selectionStart ?? draft.value.length, person.display_name)
  draft.value = r.text
  mentionMap.value[person.display_name] = person.id
  closePicker()
  nextTick(() => {
    el.focus()
    el.setSelectionRange(r.caret, r.caret)
  })
}

function onComposerKeydown(e: KeyboardEvent) {
  if (picker.open && candidates.value.length) {
    const n = candidates.value.length
    if (e.key === 'ArrowDown') { e.preventDefault(); picker.index = (picker.index + 1) % n; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); picker.index = (picker.index - 1 + n) % n; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates.value[picker.index]!); return }
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); return }
  }
  if (e.key === 'Escape' && replyingTo.value) { e.preventDefault(); replyingTo.value = null; return }
  if (e.key === 'Enter') onEnter(e)
  else if (e.key === 'ArrowUp') onArrowUp(e)
}

const mentionsMe = (m: Message) => mentionsUser(m.body, chat.myId)

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) return // newline
  e.preventDefault()
  send()
}

const canDeleteAttachment = (m: Message) => m.user_id === chat.myId || chat.canManageChannel(channel.value)

async function removeAttachment(m: Message, a: Pick<Attachment, 'id' | 'path' | 'file_name'>) {
  if (!confirm(`Delete ${a.file_name}? The message stays, and the file is removed for everyone.`)) return
  const { error: fileError } = await supabase.storage.from('attachments').remove([a.path])
  if (fileError) {
    toast.add({ title: 'Could not delete attachment', description: errorMessage(fileError), color: 'error' })
    return
  }
  const { error } = await supabase.from('message_attachments').update({ deleted_at: new Date().toISOString() }).eq('id', a.id)
  if (error) {
    toast.add({ title: 'Could not delete attachment', description: errorMessage(error), color: 'error' })
    return
  }
  const target = m.message_attachments?.find((x) => x.id === a.id)
  if (target) target.deleted_at = new Date().toISOString()
}

async function remove(m: Message) {
  const paths = (m.message_attachments ?? []).filter((a) => !a.deleted_at).map((a) => a.path)
  if (paths.length) await supabase.storage.from('attachments').remove(paths) // best effort
  const { error } = await supabase.from('messages').delete().eq('id', m.id)
  if (error) toast.add({ title: 'Could not delete', description: error.message, color: 'error' })
  else messages.value = messages.value.filter((x) => x.id !== m.id)
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: 'short' })

function dayLabel(iso: string) {
  const d = new Date(iso)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: days > 300 ? 'numeric' : undefined })
}

// Day dividers, and consecutive messages from one person within 5 minutes share a single header.
const rows = computed(() =>
  messages.value.map((m, i) => {
    const prev = messages.value[i - 1]
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
    const grouped = !newDay && !!prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000
    return { m, newDay, grouped, dayLabel: newDay ? dayLabel(m.created_at) : '' }
  }),
)

const profileStore = useProfileStore()
const readOnly = computed(() => profileStore.isViewer && channel.value?.kind === 'project')
const deleteOpen = ref(false)
const deleting = ref(false)
async function removeProject() {
  if (!channel.value) return
  deleting.value = true
  try {
    await chat.setProjectArchived(channel.value.id, true)
    deleteOpen.value = false
    await navigateTo('/')
  } catch (e) {
    useToast().add({ title: 'Could not archive the project', description: errorMessage(e), color: 'error' })
  } finally {
    deleting.value = false
  }
}

const time = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b border-accented bg-default px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <template v-if="channel?.kind === 'dm'">
          <UserAvatar :name="chat.channelTitle(channel)" :status="chat.displayStatus(chat.otherUser(channel)?.id)" size="sm" ring="default" />
          <span class="truncate text-base font-semibold text-highlighted">{{ chat.channelTitle(channel) }}</span>
        </template>
        <template v-else-if="channel">
          <UIcon :name="channel.is_private ? 'i-lucide-lock' : 'i-lucide-hash'" class="size-5 shrink-0 text-muted" />
          <span class="truncate text-base font-semibold text-highlighted">{{ channel.name }}</span>
          <span v-if="clientName" class="hidden truncate text-sm text-muted sm:inline">in {{ clientName }}</span>
        </template>
        <span v-else class="text-muted">…</span>
      </div>
      <div v-if="channel?.kind === 'project'" class="flex items-center gap-1">
        <UButton
          :icon="watching ? 'i-lucide-bell-ring' : 'i-lucide-bell'"
          size="sm"
          :color="watching ? 'primary' : 'neutral'"
          variant="ghost"
          :title="watching ? 'Notifying for every message. Click to only be notified for @mentions.' : 'Click to get desktop notifications for every message here (mentions always notify).'"
          :aria-label="watching ? 'Stop notifying for every message' : 'Notify me for every message'"
          @click="toggleWatch"
        />
        <UButton icon="i-lucide-users" size="sm" color="neutral" variant="ghost" @click="membersOpen = true">
          <span class="hidden sm:inline">Members</span>
        </UButton>
        <UButton v-if="chat.canManageChannel(channel)" icon="i-lucide-archive" size="sm" color="neutral" variant="ghost" title="Archive project" aria-label="Archive project" @click="deleteOpen = true" />
      </div>
    </div>

    <UModal v-if="channel?.kind === 'project'" v-model:open="deleteOpen" title="Archive project">
      <template #body>
        <p class="text-sm">Archive <strong>{{ channel.name }}</strong>? It disappears for everyone, including its messages and search results. Nothing is deleted: an admin can restore it from Archived.</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="deleteOpen = false">Cancel</UButton>
          <UButton :loading="deleting" @click="removeProject">Archive project</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-if="channel?.kind === 'project'" v-model:open="membersOpen" title="Project members">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          {{ channel.is_private
            ? 'Private project: only these people and admins can see it.'
            : 'Everyone in the client can see this project. Add people here to track who is on it.' }}
        </p>
        <MembersEditor kind="channel" :id="channel.id" :can-manage="chat.canManageChannel(channel)" />
      </template>
    </UModal>

    <div v-if="chat.loaded && !channel" class="p-6 text-muted">This conversation doesn't exist or you don't have access.</div>

    <template v-else>
      <div ref="scroller" class="flex-1 overflow-y-auto px-4 py-3">
        <p v-if="loading" class="text-muted">Loading…</p>
        <p v-else-if="!messages.length" class="text-muted">No messages yet. Say hello!</p>
        <template v-for="r in rows" :key="r.m.id">
          <div v-if="r.newDay" class="flex items-center gap-3 py-3 text-xs font-medium text-muted">
            <span class="h-px flex-1 bg-accented" />{{ r.dayLabel }}<span class="h-px flex-1 bg-accented" />
          </div>
          <div
            :data-message-id="r.m.id"
            tabindex="0" class="group relative flex gap-3 rounded-md px-2 py-0.5 outline-none transition-colors duration-700 hover:bg-muted/70"
            :class="[r.grouped ? '' : 'mt-3 first:mt-0', mentionsMe(r.m) ? 'border-l-2 border-primary bg-primary/5' : '', highlightId === r.m.id ? 'bg-primary/20!' : '', r.m.pending ? 'opacity-60' : '']"
          >
            <div class="w-9 shrink-0 pt-0.5">
              <UserAvatar v-if="!r.grouped" :name="chat.userName(r.m.user_id)" :status="chat.displayStatus(r.m.user_id)" ring="default" />
              <span v-else class="hidden pt-1 text-right text-[10px] leading-5 text-dimmed group-hover:block group-focus-within:block">{{ clock(r.m.created_at) }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div v-if="!r.grouped" class="flex items-baseline gap-2">
                <span class="font-semibold text-highlighted">{{ chat.userName(r.m.user_id) }}</span>
                <span class="text-xs text-muted">{{ time(r.m.created_at) }}<span v-if="r.m.edited_at"> (edited)</span></span>
              </div>
              <div
                v-if="!r.m.pending && editingId !== r.m.id"
                class="absolute -top-3 right-2 flex rounded-md border border-accented bg-default opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <UButton v-if="!readOnly" icon="i-lucide-reply" size="xs" color="neutral" variant="ghost" aria-label="Reply" title="Reply" @click="startReply(r.m)" />
                <template v-if="r.m.user_id === chat.myId">
                  <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" aria-label="Edit message" @click="startEdit(r.m)" />
                  <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" aria-label="Delete message" @click="remove(r.m)" />
                </template>
              </div>
              <button
                v-if="r.m.reply_to"
                type="button"
                class="mb-1 flex w-full max-w-md items-stretch gap-2 overflow-hidden rounded-md bg-elevated/70 text-left text-sm hover:bg-elevated"
                :aria-label="quoteOf(r.m) ? `Go to the message from ${chat.userName(quoteOf(r.m)!.user_id)}` : 'Original message deleted'"
                :disabled="!quoteOf(r.m)"
                @click="jumpTo(r.m.reply_to!)"
              >
                <span class="w-1 shrink-0 bg-primary" />
                <span class="min-w-0 py-1 pr-2">
                  <template v-if="quoteOf(r.m)">
                    <span class="block truncate text-xs font-semibold text-primary">{{ chat.userName(quoteOf(r.m)!.user_id) }}</span>
                    <span class="line-clamp-2 break-words text-toned">{{ quoteText(quoteOf(r.m)!) }}</span>
                  </template>
                  <span v-else class="block italic text-muted">Loading original message…</span>
                </span>
              </button>
              <div v-if="editingId === r.m.id" class="mt-1">
                <UTextarea
                  v-model="editDraft"
                  autoresize
                  :maxrows="8"
                  maxlength="4000"
                  autofocus
                  class="w-full"
                  @keydown.enter="onEditEnter(r.m, $event)"
                  @keydown.esc="cancelEdit"
                />
                <div class="mt-1 flex items-center gap-2 text-xs text-muted">
                  <UButton size="xs" @click="saveEdit(r.m)">Save</UButton>
                  <UButton size="xs" color="neutral" variant="ghost" @click="cancelEdit">Cancel</UButton>
                  Enter to save, Esc to cancel
                </div>
              </div>
              <MessageBody v-else-if="r.m.body" :body="r.m.body" />
              <span v-if="r.grouped && r.m.edited_at && editingId !== r.m.id" class="text-xs text-muted">(edited)</span>
              <MessageAttachments
                v-if="r.m.message_attachments?.length"
                :attachments="r.m.message_attachments"
                :can-delete="canDeleteAttachment(r.m)"
                @delete="(a) => removeAttachment(r.m, a)"
              />
            </div>
          </div>
        </template>
      </div>

      <div v-if="readOnly" class="mx-4 mb-4 mt-1 flex items-center gap-2 rounded-xl border border-accented bg-muted/60 px-4 py-3 text-sm text-muted">
        <UIcon name="i-lucide-eye" class="size-4 shrink-0" />
        You have read-only access to this project. Use a direct message to ask someone about it.
      </div>
      <form
        v-else
        class="px-4 pb-4 pt-1"
        @submit.prevent="send"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <div class="rounded-xl border bg-muted/60 p-2 transition-colors focus-within:border-primary" :class="dragging ? 'border-primary bg-primary/10' : 'border-accented'">
        <div v-if="replyingTo" class="mb-2 flex items-stretch gap-2 overflow-hidden rounded-md bg-elevated/70 text-sm">
          <span class="w-1 shrink-0 bg-primary" />
          <div class="min-w-0 flex-1 py-1">
            <span class="block truncate text-xs font-semibold text-primary">Replying to {{ chat.userName(replyingTo.user_id) }}</span>
            <span class="line-clamp-2 break-words text-toned">{{ quoteText({ user_id: replyingTo.user_id, body: replyingTo.body, hasFiles: (replyingTo.message_attachments ?? []).some((a) => !a.deleted_at) }) }}</span>
          </div>
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" class="self-start" aria-label="Cancel reply" @click="replyingTo = null" />
        </div>
        <div v-if="files.length" class="mb-2 flex flex-wrap gap-2">
          <UBadge v-for="(f, i) in files" :key="`${f.name}-${i}`" color="neutral" variant="subtle" class="gap-1">
            {{ f.name }} <span class="text-muted">{{ formatBytes(f.size) }}</span>
            <button type="button" class="ml-1" aria-label="Remove file" @click="files.splice(i, 1)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </UBadge>
        </div>
        <div class="relative flex items-end gap-2">
          <ul
            v-if="candidates.length"
            class="absolute bottom-full left-12 z-10 mb-1 w-64 overflow-hidden rounded-md border border-default bg-default shadow-lg"
            role="listbox"
          >
            <li
              v-for="(p, i) in candidates"
              :key="p.id"
              role="option"
              :aria-selected="i === picker.index"
              class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
              :class="{ 'bg-elevated': i === picker.index }"
              @mousedown.prevent="pick(p)"
            >
              <UIcon v-if="p.id === CHANNEL_MENTION" name="i-lucide-users" class="size-3" />
              <StatusDot v-else :status="chat.displayStatus(p.id)" size="sm" />
              {{ p.display_name }}
              <span v-if="p.id === CHANNEL_MENTION" class="text-xs text-muted">notify everyone here</span>
            </li>
          </ul>
          <input ref="fileInput" type="file" multiple class="hidden" @change="onPickFiles" />
          <UButton icon="i-lucide-paperclip" color="neutral" variant="ghost" aria-label="Attach files" @click="fileInput?.click()" />
          <UTextarea
            ref="composer"
            v-model="draft"
            :rows="2"
            autoresize
            :maxrows="8"
            maxlength="4000"
            placeholder="Message (Enter to send, @ to mention, paste or drop files)"
            variant="none"
            class="flex-1"
            @keydown="onComposerKeydown"
            @input="updatePicker"
            @click="updatePicker"
            @keyup.left="updatePicker"
            @keyup.right="updatePicker"
            @blur="closePicker"
            @paste="onPaste"
          />
          <UButton type="submit" icon="i-lucide-send-horizontal" :disabled="!draft.trim() && !files.length" aria-label="Send message" />
        </div>
        </div>
      </form>
    </template>
  </div>
</template>
