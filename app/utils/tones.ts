// Notification tones, synthesised with Web Audio so there are no sound files to ship or cache.
// Each tone is a short list of notes; `at` and `dur` are seconds from the start.

export type ToneId = 'none' | 'classic' | 'chime' | 'ding' | 'pop' | 'bubble' | 'bell' | 'knock' | 'alert' | 'rise'

/** What a notification is about; each can have its own tone. */
export type ToneCategory = 'dm' | 'mention' | 'channel'

export interface Note {
  freq: number
  at: number
  dur: number
  type?: OscillatorType
  gain?: number
  /** glide to this frequency over the note (for pops and bubbles) */
  to?: number
}

export const TONES: Record<ToneId, { label: string; notes: Note[] }> = {
  none: { label: 'None (silent)', notes: [] },
  classic: { label: 'Classic beep', notes: [{ freq: 880, at: 0, dur: 0.25 }] },
  chime: { label: 'Chime', notes: [{ freq: 1046.5, at: 0, dur: 0.3 }, { freq: 1318.5, at: 0.12, dur: 0.45 }] },
  ding: { label: 'Ding', notes: [{ freq: 1568, at: 0, dur: 0.6, type: 'triangle', gain: 0.2 }] },
  pop: { label: 'Pop', notes: [{ freq: 400, to: 900, at: 0, dur: 0.08, gain: 0.25 }] },
  bubble: { label: 'Bubble', notes: [{ freq: 500, to: 1200, at: 0, dur: 0.12 }, { freq: 700, to: 1500, at: 0.13, dur: 0.12 }] },
  bell: {
    label: 'Bell',
    notes: [
      { freq: 784, at: 0, dur: 0.9, type: 'triangle', gain: 0.18 },
      { freq: 1568, at: 0, dur: 0.6, gain: 0.06 },
    ],
  },
  knock: {
    label: 'Knock knock',
    notes: [
      { freq: 180, to: 120, at: 0, dur: 0.07, type: 'square', gain: 0.12 },
      { freq: 180, to: 120, at: 0.16, dur: 0.07, type: 'square', gain: 0.12 },
    ],
  },
  alert: {
    label: 'Alert',
    notes: [
      { freq: 988, at: 0, dur: 0.1, type: 'square', gain: 0.08 },
      { freq: 988, at: 0.15, dur: 0.1, type: 'square', gain: 0.08 },
      { freq: 1319, at: 0.3, dur: 0.18, type: 'square', gain: 0.08 },
    ],
  },
  rise: {
    label: 'Rising',
    notes: [
      { freq: 523, at: 0, dur: 0.14 },
      { freq: 659, at: 0.1, dur: 0.14 },
      { freq: 784, at: 0.2, dur: 0.3 },
    ],
  },
}

export const TONE_OPTIONS = (Object.keys(TONES) as ToneId[]).map((id) => ({ value: id, label: TONES[id].label }))

export const TONE_CATEGORIES: { value: ToneCategory; label: string; description: string }[] = [
  { value: 'dm', label: 'Direct messages', description: 'Someone writes to you directly' },
  { value: 'mention', label: '@Mentions', description: 'Someone mentions you in a channel' },
  { value: 'channel', label: 'Channel messages', description: 'New messages in channels you watch' },
]

export const DEFAULT_TONES: Record<ToneCategory, ToneId> = { dm: 'chime', mention: 'alert', channel: 'classic' }

export const isToneId = (v: unknown): v is ToneId => typeof v === 'string' && v in TONES

/** Stored preferences may be missing, partial or hold a tone that no longer exists: fall back per category. */
export function resolveTones(stored: unknown): Record<ToneCategory, ToneId> {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  return {
    dm: isToneId(s.dm) ? s.dm : DEFAULT_TONES.dm,
    mention: isToneId(s.mention) ? s.mention : DEFAULT_TONES.mention,
    channel: isToneId(s.channel) ? s.channel : DEFAULT_TONES.channel,
  }
}

/** Which tone a message gets: a mention wins over the conversation type. */
export function toneCategory(m: { kind: 'dm' | 'project'; mentionsMe: boolean }): ToneCategory {
  if (m.mentionsMe) return 'mention'
  return m.kind === 'dm' ? 'dm' : 'channel'
}

/** Play a tone. `volume` is 0..1. Silently does nothing if the browser blocks audio. */
export function playTone(id: ToneId, volume = 1) {
  const notes = TONES[id]?.notes ?? []
  if (!notes.length || volume <= 0) return
  try {
    const ctx = new AudioContext()
    const t0 = ctx.currentTime + 0.01
    let end = 0
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = n.type ?? 'sine'
      osc.frequency.setValueAtTime(n.freq, t0 + n.at)
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur)
      const peak = Math.max(0.0002, (n.gain ?? 0.15) * volume)
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.dur + 0.05)
      end = Math.max(end, n.at + n.dur + 0.1)
    }
    setTimeout(() => void ctx.close().catch(() => {}), end * 1000 + 100)
  } catch {
    // blocked by the browser's autoplay rules: the visual notification still shows
  }
}
