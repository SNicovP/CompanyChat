// Builds the text of a push notification. Pure functions with no Deno imports so Vitest can test them.
// Mirrors app/utils/notify.ts (kept separate because Edge Functions are bundled on their own).

export type PushKind = 'dm' | 'mention' | 'watch'

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const TOKEN = new RegExp(`@\\[(${UUID}|channel)\\]`, 'gi')

export function truncate(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** "@[uuid]" tokens become "@Name"; an empty (attachment-only) message says so. */
export function readableBody(body: string, nameOf: (id: string) => string): string {
  const text = body.replace(TOKEN, (_all, id: string) => (id.toLowerCase() === 'channel' ? '@channel' : `@${nameOf(id.toLowerCase())}`))
  return truncate(text) || 'Sent an attachment'
}

export interface PushPayload {
  title: string
  body: string
  tag: string // a newer message in the same channel replaces the older notification
  url: string
}

export function buildPush(opts: {
  kind: PushKind
  channelId: string
  channelKind: 'dm' | 'project'
  channelName: string | null
  senderName: string
  body: string
  showPreview: boolean
  nameOf: (id: string) => string
}): PushPayload {
  const text = readableBody(opts.body, opts.nameOf)
  const url = `/c/${opts.channelId}`
  const tag = opts.channelId
  if (opts.channelKind === 'dm') return { title: opts.senderName, body: opts.showPreview ? text : 'New message', tag, url }
  const title = `# ${opts.channelName ?? 'channel'}`
  if (!opts.showPreview) return { title, body: opts.kind === 'mention' ? `${opts.senderName} mentioned you` : 'New message', tag, url }
  return { title, body: `${opts.senderName}: ${text}`, tag, url }
}
