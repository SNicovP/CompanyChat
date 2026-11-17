import { describe, expect, it } from 'vitest'
import { DEFAULT_TONES, RINGTONES, TONES, builtinNotes, customIdOf, customRef, isValidTone, reconcileTones, resolveTones, toneCategory } from '../app/utils/tones'

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
    expect(resolveTones({ dm: 'none', mention: 'pop', channel: 'ding', call: 'none' })).toEqual({ dm: 'none', mention: 'pop', channel: 'ding', call: 'none' })
  })

  it('every default is a real built-in', () => {
    for (const c of ['dm', 'mention', 'channel', 'call'] as const) expect(builtinNotes(c, DEFAULT_TONES[c])?.length).toBeGreaterThan(0)
  })

  it('gives accounts saved before calls had a ringtone the default ring', () => {
    expect(resolveTones({ dm: 'bell', mention: 'pop', channel: 'ding' }).call).toBe('ring')
  })

  it('keeps uploaded sounds, and only real ringtones for calls', () => {
    const mine = customRef('0b7d6a3e-1f2c-4d5e-8a9b-0c1d2e3f4a5b')
    expect(resolveTones({ dm: mine, call: mine })).toEqual({ ...DEFAULT_TONES, dm: mine, call: mine })
    expect(resolveTones({ call: 'chime' }).call).toBe('ring') // a message tone is not a ringtone
    expect(resolveTones({ dm: 'trill' }).dm).toBe(DEFAULT_TONES.dm) // ...and a ringtone is not a message tone
    expect(resolveTones({ dm: 'custom:../../etc' }).dm).toBe(DEFAULT_TONES.dm)
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

describe('uploaded sound references', () => {
  const id = '0b7d6a3e-1f2c-4d5e-8a9b-0c1d2e3f4a5b'

  it('round-trips the sound id', () => {
    expect(customIdOf(customRef(id))).toBe(id)
    expect(customIdOf('chime')).toBeNull()
  })

  it('is valid for every category, but has no built-in notes', () => {
    for (const c of ['dm', 'mention', 'channel', 'call'] as const) {
      expect(isValidTone(c, customRef(id))).toBe(true)
      expect(builtinNotes(c, customRef(id))).toBeNull()
    }
  })
})

describe('ringtones', () => {
  it('each fits in one ring cycle (they repeat every 3 seconds)', () => {
    for (const r of Object.values(RINGTONES)) for (const n of r.notes) expect(n.at + n.dur).toBeLessThan(2.5)
  })

  it('built-in message tones and ringtones are separate lists', () => {
    expect(builtinNotes('call', 'ring')).toBe(RINGTONES.ring.notes)
    expect(builtinNotes('dm', 'chime')).toBe(TONES.chime.notes)
    expect(builtinNotes('call', 'chime')).toBeNull()
  })
})
