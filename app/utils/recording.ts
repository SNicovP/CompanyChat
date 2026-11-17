import { desktopBridge } from './desktop'

// MediaRecorder support differs per browser (Chrome/Firefox: WebM/Ogg, Safari: MP4). Pick the first one that works.

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export function pickRecordingType(kind: 'audio' | 'video'): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return (kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES).find((t) => MediaRecorder.isTypeSupported?.(t))
}

export const extensionFor = (mime: string) => (mime.includes('mp4') ? (mime.startsWith('audio') ? 'm4a' : 'mp4') : mime.includes('ogg') ? 'ogg' : 'webm')

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

type MediaKind = 'camera' | 'microphone'

/**
 * Ask for the camera and/or microphone. In the macOS desktop app this first asks macOS itself (an app must be allowed
 * in System Settings › Privacy & Security before the page can get the device). If the device rejects the requested
 * quality settings, it tries once more with plain defaults.
 */
export async function requestMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const kinds: MediaKind[] = [...(constraints.audio ? ['microphone' as const] : []), ...(constraints.video ? ['camera' as const] : [])]
  const ask = desktopBridge()?.askMediaAccess
  if (ask) {
    for (const kind of kinds) {
      if (!(await ask(kind).catch(() => true))) throw new DOMException('Permission denied by system', 'NotAllowedError')
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    if ((e as { name?: string })?.name !== 'OverconstrainedError') throw e
    return navigator.mediaDevices.getUserMedia({ audio: !!constraints.audio, video: !!constraints.video })
  }
}

interface Platform {
  mac: boolean
  /** installed web app (PWA), not a browser tab */
  standalone: boolean
  /** the Electron desktop app */
  desktop: boolean
  safari: boolean
}

function platform(): Platform {
  if (typeof navigator === 'undefined') return { mac: false, standalone: false, desktop: false, safari: false }
  const ua = navigator.userAgent
  return {
    mac: /Macintosh|Mac OS X/.test(ua) && !(navigator.maxTouchPoints > 1), // iPads also claim to be Macs
    standalone: typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches),
    desktop: !!desktopBridge(),
    safari: /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(ua),
  }
}

/** A friendly reason getUserMedia failed, with where to turn the permission on for this kind of app. */
export function mediaErrorMessage(e: unknown, what: MediaKind, on: Platform = platform()): string {
  const name = (e as { name?: string })?.name
  const message = String((e as { message?: string })?.message ?? '')
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const pane = what === 'microphone' ? 'Microphone' : 'Camera'
    if (/system/i.test(message)) {
      // The operating system blocked the app or browser itself (Chrome: "Permission denied by system").
      if (!on.mac) return `Your system settings block the ${what} for this app. Allow it in your privacy settings, then reopen the app.`
      const app = on.desktop ? 'CompanyChat' : on.safari ? 'Safari' : 'your browser (e.g. Google Chrome)'
      return `macOS is blocking the ${what}. Open System Settings › Privacy & Security › ${pane}, turn on ${app}, then quit and reopen it.`
    }
    if (/dismiss/i.test(message)) return `The ${what} request was closed. Try again and choose Allow.`
    if (on.desktop) return `CompanyChat isn't allowed to use your ${what}. Allow it in System Settings › Privacy & Security › ${pane}.`
    if (on.safari) return `Safari isn't allowing the ${what} for CompanyChat. Open Safari › Settings › Websites › ${pane}, set CompanyChat to Allow, then try again.`
    if (on.standalone) return `The ${what} is blocked for CompanyChat. Click the app's ⋮ menu › App info (or the icon in the title bar), set ${pane} to Allow, then try again.`
    return `The ${what} is blocked for this site. Click the icon next to the address bar, set ${pane} to Allow, then try again.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found on this device.`
  if (name === 'NotReadableError') return `Your ${what} is being used by another app.`
  return `Could not start the ${what}.`
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Timestamp for file names: 2026-11-17_14-03-22 */
export const stamp = () => new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
