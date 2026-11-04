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
export function notifyDecision(i: NotifyInput): { notify: boolean; reason: string } {
  if (i.fromSelf) return { notify: false, reason: 'your own message' }
  if (i.windowFocused) return { notify: false, reason: 'this window has focus' }
  if (i.status === 'dnd') return { notify: false, reason: 'status is Do not disturb' }
  if (i.mentionsMe) return { notify: true, reason: 'you were mentioned' }
  if (i.kind === 'dm') return { notify: true, reason: 'direct message' }
  return i.watching
    ? { notify: true, reason: 'you watch this channel' }
    : { notify: false, reason: 'project message in a channel you do not watch (only mentions notify)' }
}

export const shouldNotify = (i: NotifyInput): boolean => notifyDecision(i).notify

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
