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

  async function check(retry = true) {
    if (checking || !current) return
    checking = true
    try {
      const res = await fetch(`/_nuxt/builds/latest.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return console.debug('[update] could not read latest.json:', res.status)
      const latest = (await res.json()) as { id?: string }
      if (!latest.id || latest.id === current) return console.debug('[update] up to date', current)
      console.debug('[update] new version', latest.id, 'running', current)
      if (!hasDraft()) return location.reload()
      if (asked) return
      asked = true
      toast.add({
        title: 'A new version is available',
        description: 'Finish your message, then reload to update.',
        duration: 0,
        actions: [{ label: 'Reload now', onClick: () => location.reload() }],
      })
    } catch (e) {
      // Often the network is not back yet when a phone wakes the app: try once more shortly.
      console.debug('[update] check failed:', e)
      if (retry) setTimeout(() => check(false), 4000)
    } finally {
      checking = false
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === "visible") check() })
  window.addEventListener('focus', () => check())
  window.addEventListener('online', () => check())
  window.addEventListener('pageshow', () => check()) // restored from the back/forward cache
  setInterval(() => { if (document.visibilityState === 'visible') check() }, 10 * 60_000)
  check()
})
