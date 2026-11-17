// MediaRecorder support differs per browser (Chrome/Firefox: WebM/Ogg, Safari: MP4). Pick the first one that works.

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export function pickRecordingType(kind: 'audio' | 'video'): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return (kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES).find((t) => MediaRecorder.isTypeSupported?.(t))
}

export const extensionFor = (mime: string) => (mime.includes('mp4') ? (mime.startsWith('audio') ? 'm4a' : 'mp4') : mime.includes('ogg') ? 'ogg' : 'webm')

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** A friendly reason getUserMedia failed. */
export function mediaErrorMessage(e: unknown, what: 'camera' | 'microphone'): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return `CompanyChat isn't allowed to use your ${what}. Allow it in your browser or system settings and try again.`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found on this device.`
  if (name === 'NotReadableError') return `Your ${what} is being used by another app.`
  return `Could not start the ${what}.`
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Timestamp for file names: 2026-11-17_14-03-22 */
export const stamp = () => new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
