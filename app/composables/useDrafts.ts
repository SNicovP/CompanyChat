// Unsent composer text per conversation, kept per person on this device (localStorage), so switching chats
// (or reloading) never loses what you were typing.
const key = (userId: string) => `companychat:drafts:${userId}`

export function useDrafts() {
  const chat = useChatStore()
  const book = useState<DraftBook>('drafts', () => ({}))
  let loadedFor: string | null = null

  function ensureLoaded() {
    const me = chat.myId
    if (!me || loadedFor === me) return
    loadedFor = me
    try {
      book.value = parseDrafts(localStorage.getItem(key(me)))
    } catch {
      book.value = {}
    }
  }

  function get(channelId: string): Draft {
    ensureLoaded()
    return book.value[channelId] ?? { text: '', map: {} }
  }

  function set(channelId: string, text: string, map: Record<string, string>) {
    ensureLoaded()
    book.value = withDraft(book.value, channelId, text, map)
    try {
      if (chat.myId) localStorage.setItem(key(chat.myId), JSON.stringify(book.value))
    } catch {
      // private mode: drafts just last until reload
    }
  }

  return { get, set, book }
}
