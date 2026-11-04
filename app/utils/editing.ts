export const MAX_MESSAGE_LENGTH = 4000

export type EditCheck =
  | { action: 'save'; body: string }
  | { action: 'cancel' } // nothing changed
  | { action: 'reject'; reason: string }

/** Decide what saving an edited message should do. */
export function checkEdit(next: string, previous: string, hasLiveAttachments: boolean): EditCheck {
  const body = next.trim()
  if (body === previous.trim()) return { action: 'cancel' }
  if (body.length > MAX_MESSAGE_LENGTH) return { action: 'reject', reason: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` }
  if (!body && !hasLiveAttachments) return { action: 'reject', reason: 'A message needs some text. Use the delete button to remove it.' }
  return { action: 'save', body }
}
