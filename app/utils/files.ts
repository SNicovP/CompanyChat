export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** Audio and video (voice notes, camera recordings) may be bigger; same limit as the API. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 5

// Browsers render these safely inline; everything else is offered as a download.
const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const isInlineImage = (mime: string | null | undefined) => !!mime && INLINE_IMAGE_TYPES.includes(mime)

// Played in the app's own players (the API serves these inline too).
const INLINE_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a']
const INLINE_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']
export const isInlineAudio = (mime: string | null | undefined) => !!mime && INLINE_AUDIO_TYPES.includes(baseType(mime))
export const isInlineVideo = (mime: string | null | undefined) => !!mime && INLINE_VIDEO_TYPES.includes(baseType(mime))

/** "audio/webm;codecs=opus" -> "audio/webm" */
export const baseType = (mime: string) => mime.split(';')[0]!.trim().toLowerCase()

/** Voice notes are recorded in the app and named voice-note-<time>.<ext>. */
export const VOICE_NOTE_PREFIX = 'voice-note-'

export type AttachmentKind = 'image' | 'video' | 'voice' | 'audio' | 'file'

export function attachmentKind(a: { mime_type: string | null; file_name: string }): AttachmentKind {
  if (isInlineImage(a.mime_type)) return 'image'
  if (isInlineVideo(a.mime_type)) return 'video'
  if (isInlineAudio(a.mime_type)) return a.file_name.startsWith(VOICE_NOTE_PREFIX) ? 'voice' : 'audio'
  return 'file'
}

/** Storage-safe file name: letters, digits, dot, dash, underscore. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '')
  return (cleaned || 'file').slice(-100)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 75 -> "1:15" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const maxBytesFor = (type: string | null | undefined) =>
  type && (type.startsWith('video/') || type.startsWith('audio/')) ? MAX_MEDIA_BYTES : MAX_FILE_BYTES

/** Returns an error message, or null if the file may be attached. */
export function validateFile(file: { name: string; size: number; type?: string }): string | null {
  if (file.size === 0) return `${file.name} is empty.`
  const max = maxBytesFor(file.type)
  if (file.size > max) return `${file.name} is larger than ${formatBytes(max)}.`
  return null
}

/** One line for a message that has no text: "🎤 Voice note", "📷 Photo +2", "📍 Client office"... (matches the API). */
export function messageSummary(m: {
  share?: { type: 'location'; label?: string } | { type: 'contact'; name: string } | { type: 'call'; status: string } | null
  message_attachments?: { mime_type: string | null; file_name: string; deleted_at: string | null }[]
}): string | null {
  if (m.share?.type === 'location') return `📍 ${m.share.label || 'Location'}`
  if (m.share?.type === 'contact') return `👤 ${m.share.name || 'Contact'}`
  if (m.share?.type === 'call') return callSummary(m.share.status)
  const live = (m.message_attachments ?? []).filter((a) => !a.deleted_at)
  if (!live.length) return null
  const first = live[0]!
  const label = { voice: '🎤 Voice note', audio: '🎵 Audio', video: '🎥 Video', image: '📷 Photo', file: `📎 ${first.file_name}` }[attachmentKind(first)]
  return live.length > 1 ? `${label} +${live.length - 1}` : label
}

/** "📞 Missed call" etc. for a call-history entry (matches the API's Share::summary). */
export function callSummary(status: string): string {
  if (status === 'ended') return '📞 Voice call'
  if (status === 'missed' || status === 'cancelled') return '📞 Missed call'
  if (status === 'rejected') return '📞 Declined call'
  return '📞 Call failed'
}
