import { describe, expect, it } from 'vitest'
import { STATUS_OPTIONS, statusMeta } from '../app/utils/status'

describe('status utils', () => {
  it('returns metadata for every option', () => {
    for (const s of STATUS_OPTIONS) expect(statusMeta(s.value).label).toBe(s.label)
  })

  it('falls back to online for unknown values', () => {
    expect(statusMeta('bogus' as never).value).toBe('online')
  })
})

import { displayMeta, effectiveStatus } from '../app/utils/status'

describe('effectiveStatus', () => {
  it('shows the manual status while connected', () => {
    expect(effectiveStatus('busy', true)).toBe('busy')
    expect(effectiveStatus(undefined, true)).toBe('online')
  })

  it('shows offline when not connected, whatever the manual status', () => {
    expect(effectiveStatus('online', false)).toBe('offline')
    expect(effectiveStatus('dnd', false)).toBe('offline')
  })

  it('has display metadata for offline', () => {
    expect(displayMeta('offline').label).toBe('Offline')
  })
})
