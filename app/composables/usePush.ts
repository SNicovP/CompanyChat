// Background (Web Push) notifications for this browser/device: they arrive even when CompanyChat is closed
// (as long as the browser runs). The on/off switch is per device (localStorage); the subscription itself is
// saved in push_subscriptions so the send-push Edge Function can reach it.
const STORAGE_KEY = 'companychat:push'

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function toKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function usePush() {
  const supabase = useSupabaseClient()
  const notifier = useNotifier()
  const vapidKey = String(useRuntimeConfig().public.vapidPublicKey ?? '')
  const enabled = useState<boolean>('push-enabled', load)

  const supported = computed(() => !!vapidKey && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window)
  /** Pushes are switched on here and the browser allows notifications. */
  const active = computed(() => supported.value && enabled.value && notifier.permission.value === 'granted')

  function remember(on: boolean) {
    enabled.value = on
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
    } catch {
      // private mode: the switch just won't persist
    }
  }

  async function currentSubscription(create: boolean): Promise<PushSubscription | null> {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing || !create) return existing
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidKey) })
  }

  async function save(sub: PushSubscription) {
    const json = sub.toJSON()
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? '',
      p_auth: json.keys?.auth ?? '',
      p_preview: notifier.prefs.value.preview,
      p_user_agent: navigator.userAgent,
    })
    if (error) throw error
  }

  async function enable() {
    if (!supported.value) throw new Error('Background notifications are not available in this browser.')
    if (notifier.permission.value !== 'granted') await notifier.request()
    if (notifier.permission.value !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.')
    const sub = await currentSubscription(true)
    if (!sub) throw new Error('The browser did not create a push subscription.')
    await save(sub)
    remember(true)
  }

  async function disable() {
    const sub = await currentSubscription(false).catch(() => null)
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe().catch(() => false)
    }
    remember(false)
  }

  /** After signing in: make sure this browser's subscription belongs to the current user. */
  async function sync() {
    if (!active.value) return
    try {
      const sub = await currentSubscription(true)
      if (sub) await save(sub)
    } catch (e) {
      console.debug('[push] could not sync subscription:', e)
    }
  }

  /** On sign-out: stop pushing to this browser for that account (the device switch stays on). */
  async function forget() {
    const sub = await currentSubscription(false).catch(() => null)
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  }

  async function syncPreview() {
    if (!active.value) return
    const sub = await currentSubscription(false).catch(() => null)
    if (sub) await supabase.from('push_subscriptions').update({ show_preview: notifier.prefs.value.preview }).eq('endpoint', sub.endpoint)
  }

  return { supported, enabled, active, enable, disable, sync, forget, syncPreview }
}
