// Runs in the page with Node disabled. Exposes nothing sensitive: a flag so the web app knows it is the desktop app,
// the "Start at login" setting, a way to bring the window back, a wake-from-sleep signal and whether the window
// is on screen.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('companychatDesktop', {
  platform: process.platform,
  getLaunchAtLogin: () => ipcRenderer.invoke('desktop:get-launch-at-login'),
  setLaunchAtLogin: (on) => ipcRenderer.invoke('desktop:set-launch-at-login', !!on),
  showWindow: () => ipcRenderer.send('desktop:show-window'),
  onResume: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('desktop:resumed', listener)
    return () => ipcRenderer.removeListener('desktop:resumed', listener)
  },
  // Whether the window is on screen (not hidden in the tray or minimised). The page can't tell by itself: with
  // background throttling off, document.visibilityState always says "visible".
  onVisibility: (cb) => {
    const listener = (_e, shown) => cb(!!shown)
    ipcRenderer.on('desktop:visibility', listener)
    ipcRenderer.invoke('desktop:is-shown').then((shown) => cb(!!shown)).catch(() => {})
    return () => ipcRenderer.removeListener('desktop:visibility', listener)
  },
})
