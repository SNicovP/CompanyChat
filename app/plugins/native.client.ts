// The Android (Capacitor) app: open the conversation a notification points at, and make the back button
// behave. Does nothing in a browser.
export default defineNuxtPlugin(async () => {
  if (!isNativeApp()) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const { App } = await import('@capacitor/app')

  // Android 8+ needs a channel; FCM messages name it ('messages').
  await PushNotifications.createChannel({ id: 'messages', name: 'Messages', importance: 4, visibility: 0, vibration: true }).catch(() => {})

  await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
    const url = event.notification.data?.url
    if (typeof url === 'string' && url.startsWith('/')) navigateTo(url)
  })

  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.minimizeApp()
  })
})
