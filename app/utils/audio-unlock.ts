// Browsers only let a page play sound after the person has clicked, tapped or typed in it since it loaded. An
// intercom or announcement must play without anyone answering, so: any interaction anywhere in the app unlocks
// audio, and a stream that was blocked before that starts playing at that very interaction (inside the event
// handler, which Safari requires). The desktop and Android apps have no such rule (see desktop/main.js, Capacitor).

const waiting = new Set<() => void>()
let installed = false

/** Has this page been interacted with since it loaded (so sound may play)? */
export function audioAllowed(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return activation ? activation.hasBeenActive : true // unknown: assume yes, playback failure is still handled
}

/** Listen for the first (and any later) interaction; plays whatever was waiting. Call once on the client. */
export function installAudioUnlock() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const unlock = () => {
    if (!waiting.size) return
    const pending = [...waiting]
    waiting.clear()
    for (const play of pending) play() // synchronously, inside the gesture
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true })
}

/**
 * Play a remote audio stream. If the browser blocks it, `onBlocked` is called and it starts on the next interaction
 * with the page (then `onPlaying`). Returns a function that stops it.
 */
export function playStream(stream: MediaStream, on: { onBlocked?: () => void; onPlaying?: () => void } = {}): () => void {
  const el = new Audio()
  el.autoplay = true
  el.setAttribute('playsinline', '')
  el.srcObject = stream
  let stopped = false
  const start = () => {
    if (stopped) return
    el.play().then(() => on.onPlaying?.()).catch(() => {
      if (stopped) return
      on.onBlocked?.()
      waiting.add(start)
    })
  }
  start()
  return () => {
    stopped = true
    waiting.delete(start)
    el.pause()
    el.srcObject = null
  }
}
