// Sounds you upload to use as a notification tone or ringtone. They are saved to your account (GET/POST/DELETE
// /sounds) and, after sign-in, downloaded once into memory on each device so they play instantly and offline.
// Also the one place that plays any tone: built-in ones are synthesised, uploaded ones play from memory.
import {
  DEFAULT_TONES, RING_REPEAT_MS, builtinNotes, customIdOf, playNotes, type ToneCategory, type ToneRef, type Tones,
} from '~/utils/tones'

export interface CustomSound {
  id: string
  name: string
  mime_type: string
  size_bytes: number
}

export const MAX_SOUND_BYTES = 1024 * 1024
export const MAX_SOUND_SECONDS = 30
export const MAX_SOUNDS = 10
export const SOUND_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.opus,.webm,.aac,.m4a'

/** How long the browser says this audio lasts, or null if it can't play it. */
function audioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio()
    const done = (v: number | null) => {
      clearTimeout(timer)
      a.removeAttribute('src')
      resolve(v)
    }
    const timer = setTimeout(() => done(null), 8000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null)
    a.onerror = () => done(null)
    a.src = url
  })
}

export function useCustomSounds() {
  const api = useApi()
  const sounds = useState<CustomSound[]>('custom-sounds', () => [])
  /** sound id -> object URL of its audio, in memory */
  const urls = useState<Record<string, string>>('custom-sound-urls', () => ({}))
  const loadedFor = useState<string | null>('custom-sounds-for', () => null)

  function forget() {
    for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
    urls.value = {}
    sounds.value = []
    loadedFor.value = null
  }

  async function fetchAudio(s: CustomSound) {
    if (urls.value[s.id]) return
    const blob = await api<Blob>(`/sounds/${s.id}/file`, { responseType: 'blob' } as Record<string, unknown>)
    urls.value = { ...urls.value, [s.id]: URL.createObjectURL(blob) }
  }

  /** After sign-in: your sounds and their audio. Safe to call again; another person's sounds are dropped first. */
  async function load(userId: string) {
    if (loadedFor.value === userId) return
    forget()
    loadedFor.value = userId
    const res = await api<{ sounds: CustomSound[] }>('/sounds')
    if (loadedFor.value !== userId) return
    sounds.value = res.sounds
    await Promise.all(res.sounds.map((s) => fetchAudio(s).catch(() => {}))) // one bad file shouldn't hide the rest
  }

  /** Throws an Error with a message for the person if the file can't be used. */
  async function upload(file: File): Promise<CustomSound> {
    if (sounds.value.length >= MAX_SOUNDS) throw new Error(`You can keep up to ${MAX_SOUNDS} sounds. Delete one first.`)
    if (file.size > MAX_SOUND_BYTES) throw new Error('That file is larger than 1 MB. Use a shorter or smaller sound.')
    const url = URL.createObjectURL(file)
    const seconds = await audioDuration(url)
    if (seconds === null) {
      URL.revokeObjectURL(url)
      throw new Error('This browser cannot play that file. Use an MP3, WAV, OGG or M4A sound.')
    }
    if (seconds > MAX_SOUND_SECONDS + 0.5) {
      URL.revokeObjectURL(url)
      throw new Error(`That sound is ${Math.round(seconds)} seconds long. Use one of ${MAX_SOUND_SECONDS} seconds or less.`)
    }
    const form = new FormData()
    form.append('file', file, file.name)
    try {
      const { sound } = await api<{ sound: CustomSound }>('/sounds', { method: 'POST', body: form })
      sounds.value = [...sounds.value, sound]
      urls.value = { ...urls.value, [sound.id]: url }
      return sound
    } catch (e) {
      URL.revokeObjectURL(url)
      throw e
    }
  }

  /** Delete a sound. Returns your saved tones afterwards (anything that used it went back to its default). */
  async function remove(id: string): Promise<Partial<Tones> | null> {
    const res = await api<{ notification_tones: Partial<Tones> | null }>(`/sounds/${id}`, { method: 'DELETE' })
    sounds.value = sounds.value.filter((s) => s.id !== id)
    if (urls.value[id]) URL.revokeObjectURL(urls.value[id])
    const { [id]: _gone, ...rest } = urls.value
    urls.value = rest
    return res.notification_tones
  }

  function nameOf(ref: ToneRef): string | null {
    const id = customIdOf(ref)
    return id ? sounds.value.find((s) => s.id === id)?.name ?? null : null
  }

  /**
   * Play a tone or ringtone. `loop` repeats it until stopped (a ringtone), `maxSeconds` cuts a long uploaded sound
   * short. An uploaded sound that is gone (deleted, not downloaded yet) plays the category's default instead.
   * Returns a function that stops it. Silently does nothing if the browser blocks audio.
   */
  function play(ref: ToneRef, category: ToneCategory, opts: { volume: number; loop?: boolean; maxSeconds?: number }): () => void {
    const id = customIdOf(ref)
    const url = id ? urls.value[id] : undefined
    if (id && url) {
      const audio = new Audio(url)
      audio.volume = Math.min(1, Math.max(0, opts.volume))
      audio.loop = !!opts.loop
      void audio.play().catch(() => {})
      const stop = () => {
        clearTimeout(limit)
        audio.pause()
        audio.removeAttribute('src')
      }
      const limit = opts.maxSeconds ? setTimeout(stop, opts.maxSeconds * 1000) : undefined
      return stop
    }
    const notes = builtinNotes(category, id ? DEFAULT_TONES[category] : ref) ?? builtinNotes(category, DEFAULT_TONES[category]) ?? []
    playNotes(notes, opts.volume)
    if (!opts.loop || !notes.length) return () => {}
    const repeat = setInterval(() => playNotes(notes, opts.volume), RING_REPEAT_MS)
    return () => clearInterval(repeat)
  }

  return { sounds, urls, load, forget, upload, remove, nameOf, play }
}
