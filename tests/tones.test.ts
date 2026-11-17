import { describe, expect, it } from 'vitest'
import { DEFAULT_TONES, TONES, reconcileTones, resolveTones, toneCategory } from '../app/utils/tones'

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

describe('reconcileTones (after sign-in)', () => {
  const custom = { dm: 'bell', mention: 'pop', channel: 'none' } as const
  const base = { local: { ...DEFAULT_TONES }, localOwner: 'me' as string | null | undefined, me: 'me' }

  it('uses the account\'s tones when it has some, over anything on this device', () => {
    expect(reconcileTones({ ...base, local: { ...custom }, account: { dm: 'ding' } })).toEqual({
      tones: { ...DEFAULT_TONES, dm: 'ding' },
      upload: false,
    })
  })

  it('saves your own device choice to an account that has none yet', () => {
    expect(reconcileTones({ ...base, local: { ...custom }, account: null })).toEqual({ tones: custom, upload: true })
    // chosen before tones were saved to accounts: nobody owns it yet, so it is yours
    expect(reconcileTones({ ...base, local: { ...custom }, localOwner: undefined, account: null })).toEqual({ tones: custom, upload: true })
  })

  it('never passes someone else\'s choice on a shared browser to the next person', () => {
    expect(reconcileTones({ ...base, local: { ...custom }, localOwner: 'someone-else', account: null })).toEqual({
      tones: DEFAULT_TONES,
      upload: false,
    })
  })

  it('has nothing to save when the device is on the defaults', () => {
    expect(reconcileTones({ ...base, account: null })).toEqual({ tones: DEFAULT_TONES, upload: false })
  })
})
