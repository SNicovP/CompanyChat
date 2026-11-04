// A mention is stored in the message body as @[<user uuid>] so renames never break it.
// The composer shows and edits the friendlier "@Display Name" and converts on send.

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const TOKEN = new RegExp(`@\\[(${UUID}|channel)\\]`, 'gi')

/** Special token that mentions everyone who can see the channel. */
export const CHANNEL_MENTION = 'channel'

export type Segment = { type: 'text'; text: string } | { type: 'mention'; userId: string } | { type: 'channel' }

export function splitMentions(body: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of body.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ type: 'text', text: body.slice(last, m.index) })
    if (m[1]!.toLowerCase() === CHANNEL_MENTION) out.push({ type: 'channel' })
    else out.push({ type: 'mention', userId: m[1]!.toLowerCase() })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) })
  return out
}

/** Stored form -> editable form. `map` remembers which name stands for which user. */
export function tokensToDisplay(body: string, nameOf: (id: string) => string): { text: string; map: Record<string, string> } {
  const map: Record<string, string> = {}
  const text = body.replace(TOKEN, (_all, id: string) => {
    if (id.toLowerCase() === CHANNEL_MENTION) {
      map[CHANNEL_MENTION] = CHANNEL_MENTION
      return `@${CHANNEL_MENTION}`
    }
    const name = nameOf(id.toLowerCase())
    map[name] = id.toLowerCase()
    return `@${name}`
  })
  return { text, map }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Editable form -> stored form, for the names the user actually picked. Longest names first. */
export function displayToTokens(text: string, map: Record<string, string>): string {
  let out = text.replace(/(?<![^\s])@channel(?![\p{L}\p{N}_])/giu, `@[${CHANNEL_MENTION}]`) // typed by hand or picked
  for (const name of Object.keys(map).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`@${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'gu'), `@[${map[name]}]`)
  }
  return out
}

/** Is the caret inside an "@something" the user is typing? */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0 && text[i] !== '@' && !/\s/.test(text[i]!)) i--
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1]!)) return null // e.g. an email address
  const query = text.slice(i + 1, caret)
  return query.length <= 30 ? { start: i, query } : null
}

export function applyMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const rest = text.slice(caret)
  const inserted = `@${name}${/^\s/.test(rest) ? '' : ' '}` // no doubled space if one already follows
  const after = /^\s/.test(rest) ? 1 : 0
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length + after }
}

/** Names starting with the query first, then names containing it. */
export function filterPeople<T extends { display_name: string }>(people: T[], query: string, limit = 6): T[] {
  const q = query.toLowerCase()
  const starts = people.filter((p) => p.display_name.toLowerCase().startsWith(q))
  const contains = people.filter((p) => !p.display_name.toLowerCase().startsWith(q) && p.display_name.toLowerCase().includes(q))
  return [...starts, ...contains].slice(0, limit)
}

/** Does this message mention `userId` personally, or everyone via @channel? */
export function mentionsUser(body: string, userId: string | null | undefined): boolean {
  if (!userId) return false
  const lower = body.toLowerCase()
  return lower.includes(`@[${userId.toLowerCase()}]`) || lower.includes(`@[${CHANNEL_MENTION}]`)
}
