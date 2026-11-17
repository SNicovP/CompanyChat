import { describe, expect, it } from 'vitest'
import { laterOf } from '../app/utils/readstate'

describe('laterOf', () => {
  it('never goes backwards', () => {
    expect(laterOf('2026-11-17T10:00:05.000Z', '2026-11-17T10:00:04.000Z')).toBe('2026-11-17T10:00:05.000Z')
    expect(laterOf(undefined, '2026-11-17T10:00:04.000Z')).toBe('2026-11-17T10:00:04.000Z')
    expect(laterOf('2026-11-17T10:00:01.000Z', '2026-11-17T10:00:04.000Z')).toBe('2026-11-17T10:00:04.000Z')
  })
})
