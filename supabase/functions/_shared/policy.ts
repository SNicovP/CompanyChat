// Who may invite / deactivate whom. Pure functions with no Deno imports so Vitest can test them.

export type AppRole = 'owner' | 'admin' | 'member'
export type Decision = { ok: true } | { ok: false; reason: string }

export function canInvite(actorRole: AppRole): Decision {
  return actorRole === 'owner' || actorRole === 'admin' ? { ok: true } : { ok: false, reason: 'Only admins can invite users.' }
}

/** Used for both deactivating and reactivating. */
export function canChangeActive(actor: { id: string; role: AppRole }, target: { id: string; role: AppRole }): Decision {
  if (actor.role !== 'owner' && actor.role !== 'admin') return { ok: false, reason: 'Only admins can deactivate users.' }
  if (actor.id === target.id) return { ok: false, reason: 'You cannot deactivate yourself.' }
  if (target.role === 'owner') return { ok: false, reason: 'The owner cannot be deactivated.' }
  if (target.role === 'admin' && actor.role !== 'owner') return { ok: false, reason: 'Only the owner can deactivate an admin.' }
  return { ok: true }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function parseInvite(body: { email?: unknown; display_name?: unknown }): { email: string; display_name: string } | { error: string } {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254) return { error: 'Enter a valid email address.' }
  const name = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 80) : ''
  return { email, display_name: name || email.split('@')[0]! }
}
