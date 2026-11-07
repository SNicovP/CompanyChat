// Keep an installed/long-open app on the latest deploy without the user pressing refresh.
//
// Every deploy publishes /_nuxt/builds/latest.json with a new id. We compare it to the id this page was built
// with when the app opens or comes back to the foreground (and periodically while it stays open). If it changed
// we reload, which fetches the new files. The service worker caches nothing, so the reload is always fresh.
// If someone has an unsent draft, we ask first instead of throwing it away.
export default defineNuxtPlugin(() => {
  const toast = useToast()
  const current = useRuntimeConfig().app.buildId
  let checking = false
  let asked = false

  const hasDraft = () => [...document.querySelectorAll('textarea')].some((t) => t.value.trim().length > 0)

  async function check() {
    if (checking || !current) return
    checking = true
    try {
      const res = await fetch(`/_nuxt/builds/latest.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const latest = (await res.json()) as { id?: string }
      if (!latest.id || latest.id === current) return
      if (!hasDraft()) return location.reload()
      if (asked) return
      asked = true
      toast.add({
        title: 'A new version is available',
        description: 'Finish your message, then reload to update.',
        duration: 0,
        actions: [{ label: 'Reload now', onClick: () => location.reload() }],
      })
    } catch {
      /* offline or no manifest (dev): try again next time */
    } finally {
      checking = false
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  window.addEventListener('focus', check)
  window.addEventListener('online', check)
  setInterval(() => { if (document.visibilityState === 'visible') check() }, 10 * 60_000)
  check()
})
