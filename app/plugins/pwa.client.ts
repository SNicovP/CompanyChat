// Register the service worker (needs HTTPS or localhost) and remember the browser's install prompt.
export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.debug('[pwa] service worker not registered:', e))
  }
  // A notification was clicked while the app is open: go to that conversation without reloading.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) navigateTo(e.data.url)
  })
  const { capture } = useInstallPrompt()
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    capture(e)
  })
  window.addEventListener('appinstalled', () => capture(null))
})
