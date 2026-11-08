// CompanyChat desktop shell. It loads the live web app, so every deploy reaches the desktop app too.
// It adds what a browser tab cannot: a Dock/taskbar badge, staying running when the window is closed,
// native notifications that work while the app is in the background, and links opening in your browser.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session } = require('electron')
const path = require('node:path')

const APP_URL = process.env.COMPANYCHAT_URL || 'https://companychat-mog1jhcf.on-forge.com'
const APP_ORIGIN = new URL(APP_URL).origin
const SMOKE = process.env.COMPANYCHAT_SMOKE === '1'
const isMac = process.platform === 'darwin'

let win = null
let tray = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

function showWindow() {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** "(3) CompanyChat" or "(@2) CompanyChat" is the web app's title; the number becomes the badge. */
function applyBadge(title) {
  const m = /^\((@)?(\d+)\)/.exec(title)
  const count = m ? Number(m[2]) : 0
  app.setBadgeCount(count) // Dock badge on macOS; launcher badge on some Linux desktops
  if (tray && !isMac) tray.setToolTip(count ? `CompanyChat (${count} unread)` : 'CompanyChat')
  if (count && win && !win.isFocused() && !isMac) win.flashFrame(true) // Windows taskbar flash
}

function isAppUrl(url) {
  try { return new URL(url).origin === APP_ORIGIN } catch { return false }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 480,
    show: !SMOKE,
    backgroundColor: '#000000',
    title: 'CompanyChat',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadURL(APP_URL)

  win.webContents.on('page-title-updated', (_e, title) => applyBadge(title))
  win.on('focus', () => win.flashFrame(false))

  // Only the app itself loads in this window; every other link opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || url.startsWith('file:')) return
    e.preventDefault()
    if (/^https?:/.test(url)) shell.openExternal(url)
  })

  // Offline or server down: show a friendly page that retries on its own.
  win.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { retry: isAppUrl(failedUrl) ? failedUrl : APP_URL } })
  })

  if (SMOKE) {
    win.webContents.on('did-finish-load', async () => {
      if (win.webContents.getURL().startsWith('file:')) return
      await new Promise((r) => setTimeout(r, 2500))
      const info = await win.webContents.executeJavaScript(
        `({ title: document.title, url: location.href, hasBridge: typeof window.companychatDesktop, notification: typeof Notification !== 'undefined' ? Notification.permission : 'none', electronUA: /Electron/.test(navigator.userAgent) })`,
      )
      console.log('SMOKE_RESULT ' + JSON.stringify(info))
      quitting = true
      app.quit()
    })
    win.webContents.on('did-fail-load', (_e, code, desc) => { console.log('SMOKE_FAIL ' + code + ' ' + desc) })
  }

  // Closing the window keeps the app running (so notifications keep arriving); Quit really quits.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.on('closed', () => { win = null })
}

function createTray() {
  if (isMac) return // the Dock icon does the job on macOS
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('CompanyChat')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open CompanyChat', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', showWindow)
}

function createMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }, // copy / paste / undo
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  // Notifications and clipboard only; deny everything else the page might ask for.
  const allowed = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  createMenu()
  createTray()
  createWindow()
  if (isMac && app.dock) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'))

  app.on('activate', showWindow) // clicking the Dock icon
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { if (!isMac && quitting) app.quit() })
