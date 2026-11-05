// Register the service worker (needs HTTPS or localhost) and remember the browser's install prompt.
export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.debug('[pwa] service worker not registered:', e))
  }
  const { capture } = useInstallPrompt()
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    capture(e)
  })
  window.addEventListener('appinstalled', () => capture(null))
})
