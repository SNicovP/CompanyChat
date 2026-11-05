// Chrome/Edge/Android fire `beforeinstallprompt` once the app is installable. Safari/iOS never do:
// there, install via Share -> Add to Home Screen.
type InstallEvent = Event & { prompt: () => Promise<void> }

const deferred = shallowRef<InstallEvent | null>(null)

export function useInstallPrompt() {
  return {
    canInstall: computed(() => !!deferred.value),
    capture: (e: Event | null) => { deferred.value = e as InstallEvent | null },
    async install() {
      const e = deferred.value
      if (!e) return
      await e.prompt()
      deferred.value = null
    },
  }
}
