// CompanyChat service worker. It makes the app installable and (next) receives push notifications.
// It deliberately caches nothing: a chat app must always load the latest deploy.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
