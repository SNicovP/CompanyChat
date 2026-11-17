// Who connects to whom in a room. A group call is a full mesh: everyone has a connection to everyone else, and of
// each pair the one with the smaller user id makes the offer (so two offers never cross). In an announcement only
// the speaker connects to each listener, always as the one offering; listeners do not connect to each other.

import type { RoomRole } from '~/types/api'

export interface Member {
  id: string
  role: RoomRole
}

/** Whether I need a connection to them, and if so whether I make the offer. */
export function linkTo(me: Member, them: Member): { connect: boolean; offer: boolean } {
  if (me.id === them.id) return { connect: false, offer: false }
  if (me.role === 'member' && them.role === 'member') return { connect: true, offer: me.id < them.id }
  if (me.role === 'speaker' && them.role === 'listener') return { connect: true, offer: true }
  if (me.role === 'listener' && them.role === 'speaker') return { connect: true, offer: false }
  return { connect: false, offer: false }
}

/** A whisper on presence-room.{id} reaches everyone in it; each one is addressed to one person. */
export interface RoomSignal<S> {
  from: string
  to: string
  signal: S
}

/** "Pat", "Pat and Sam", "Pat, Sam and 2 others" */
export function namesSummary(names: string[], max = 2): string {
  if (!names.length) return ''
  if (names.length === 1) return names[0]!
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const rest = names.length - max
  return `${names.slice(0, max).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
}
