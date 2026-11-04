import type { UserStatus } from './status'
import { tokensToDisplay } from './mentions'

export interface NotifyInput {
  fromSelf: boolean
  windowFocused: boolean
  status: UserStatus | undefined
  kind: 'dm' | 'project'
  mentionsMe: boolean
  watching: boolean
}

/**
 * DMs and @mentions always notify; other project messages only if you watch the channel.
 * Nothing while you are in the window, from yourself, or on Do not disturb.
 */
export function shouldNotify(i: NotifyInput): boolean {
  if (i.fromSelf || i.windowFocused || i.status === 'dnd') return false
  if (i.mentionsMe || i.kind === 'dm') return true
  return i.watching
}

export function truncate(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Notification text; mentions are shown by name and an attachment-only message says so. */
export function notificationText(opts: {
  kind: 'dm' | 'project'
  senderName: string
  channelName: string | null
  body: string
  nameOf: (id: string) => string
}): { title: string; body: string } {
  const readable = tokensToDisplay(opts.body, opts.nameOf).text
  const text = truncate(readable) || 'Sent an attachment'
  if (opts.kind === 'dm') return { title: opts.senderName, body: text }
  return { title: `# ${opts.channelName ?? 'channel'}`, body: `${opts.senderName}: ${text}` }
}
