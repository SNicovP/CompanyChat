/** An unsent message: the composer text and the mentions picked in it (name -> user id). */
export interface Draft {
  text: string
  map: Record<string, string>
}

export type DraftBook = Record<string, Draft>

const MAX_DRAFTS = 100

export function parseDrafts(raw: string | null): DraftBook {
  try {
    const parsed = JSON.parse(raw ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DraftBook) : {}
  } catch {
    return {}
  }
}

/** Returns the book with this chat's draft set, or removed when it is empty. Pure, so it is easy to test. */
export function withDraft(book: DraftBook, channelId: string, text: string, map: Record<string, string>): DraftBook {
  const next = { ...book }
  if (!text.trim()) {
    delete next[channelId]
    return next
  }
  next[channelId] = { text, map }
  const ids = Object.keys(next)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_DRAFTS))) delete next[id] // oldest first
  return next
}
