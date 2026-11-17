import { describe, expect, it } from 'vitest'
import { DEFAULT_TONES, TONES, resolveTones, toneCategory } from '../app/utils/tones'

describe('toneCategory', () => {
  it('uses the mention tone whenever you are mentioned, even in a DM', () => {
    expect(toneCategory({ kind: 'project', mentionsMe: true })).toBe('mention')
    expect(toneCategory({ kind: 'dm', mentionsMe: true })).toBe('mention')
  })

  it('otherwise picks by conversation type', () => {
    expect(toneCategory({ kind: 'dm', mentionsMe: false })).toBe('dm')
    expect(toneCategory({ kind: 'project', mentionsMe: false })).toBe('channel')
  })
})

describe('resolveTones', () => {
  it('falls back to defaults for missing or unknown tones', () => {
    expect(resolveTones(undefined)).toEqual(DEFAULT_TONES)
    expect(resolveTones({ dm: 'bell', mention: 'gone-tone' })).toEqual({ ...DEFAULT_TONES, dm: 'bell' })
  })

  it('keeps a valid choice, including silence', () => {
    expect(resolveTones({ dm: 'none', mention: 'pop', channel: 'ding' })).toEqual({ dm: 'none', mention: 'pop', channel: 'ding' })
  })

  it('every default is a real tone', () => {
    for (const t of Object.values(DEFAULT_TONES)) expect(TONES[t]).toBeDefined()
  })
})
