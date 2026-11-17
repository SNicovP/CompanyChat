/** What the Electron desktop app's preload script exposes (undefined in a normal browser). */
export interface DesktopBridge {
  platform: string
  getLaunchAtLogin?: () => Promise<{ supported: boolean; on: boolean }>
  setLaunchAtLogin?: (on: boolean) => Promise<boolean>
  showWindow?: () => void
  onResume?: (cb: () => void) => () => void
  /** Window shown (true) or hidden in the tray / minimised (false); called once straight away with the current state. */
  onVisibility?: (cb: (shown: boolean) => void) => () => void
}

export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { companychatDesktop?: DesktopBridge }).companychatDesktop
}
