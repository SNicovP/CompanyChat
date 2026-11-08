// Runs in the page with Node disabled. Exposes nothing sensitive: just a flag so the web app knows it is the desktop app.
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('companychatDesktop', { platform: process.platform })
