/** True inside the Capacitor (Android) app; false in a browser, the PWA and the Electron app. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}
