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
