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
