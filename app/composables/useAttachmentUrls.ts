import type { Database } from '~/types/database.types'

const EXPIRES_IN = 6 * 60 * 60 // seconds

interface FileRef {
  path: string
  mime_type: string | null
}

/** Signed URLs for private attachments, cached across the app. Images open inline, other files download. */
export function useAttachmentUrls() {
  const supabase = useSupabaseClient<Database>()
  const urls = useState<Record<string, string>>('attachment-urls', () => ({}))

  async function ensure(files: FileRef[]) {
    const missing = files.filter((f) => !urls.value[f.path])
    if (!missing.length) return
    const inline = missing.filter((f) => isInlineImage(f.mime_type)).map((f) => f.path)
    const download = missing.filter((f) => !isInlineImage(f.mime_type)).map((f) => f.path)
    const results = await Promise.all([
      inline.length ? supabase.storage.from('attachments').createSignedUrls(inline, EXPIRES_IN) : null,
      download.length ? supabase.storage.from('attachments').createSignedUrls(download, EXPIRES_IN, { download: true }) : null,
    ])
    const next = { ...urls.value }
    for (const res of results) {
      for (const item of res?.data ?? []) {
        if (item.path && item.signedUrl) next[item.path] = item.signedUrl
      }
    }
    urls.value = next
  }

  return { urls, ensure }
}
