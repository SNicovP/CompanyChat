export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 5

// Browsers render these safely inline; everything else is offered as a download.
const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const isInlineImage = (mime: string | null | undefined) => !!mime && INLINE_IMAGE_TYPES.includes(mime)

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

/** Returns an error message, or null if the file may be attached. */
export function validateFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`
  return null
}
