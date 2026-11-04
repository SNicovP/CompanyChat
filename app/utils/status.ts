export type UserStatus = 'online' | 'away' | 'busy' | 'dnd'

export const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: 'bg-green-500' },
  { value: 'away', label: 'Away', color: 'bg-yellow-500' },
  { value: 'busy', label: 'Busy', color: 'bg-red-500' },
  { value: 'dnd', label: 'Do not disturb', color: 'bg-red-800' },
]

export function statusMeta(status: UserStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0]!
}

/** What other people see: connected users show their manual status, everyone else is offline. */
export type DisplayStatus = UserStatus | 'offline'

export function effectiveStatus(manual: UserStatus | undefined, connected: boolean): DisplayStatus {
  return connected ? (manual ?? 'online') : 'offline'
}

export function displayMeta(status: DisplayStatus) {
  if (status === 'offline') return { value: 'offline' as const, label: 'Offline', color: 'bg-neutral-500' }
  return statusMeta(status)
}
