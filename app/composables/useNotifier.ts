import { playTone, resolveTones, type ToneCategory, type ToneId } from '~/utils/tones'

interface Prefs {
  enabled: boolean // master switch for this browser/device
  sound: boolean
  preview: boolean // show the message text in the notification
  dismissed: boolean // user said "not now" to the permission banner
  tones: Record<ToneCategory, ToneId> // which sound each kind of message plays
  volume: number // 0..1
}

const STORAGE_KEY = 'companychat:notifications'
const DEFAULTS: Prefs = { enabled: true, sound: true, preview: true, dismissed: false, tones: resolveTones(null), volume: 0.8 }

function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const volume = typeof stored.volume === 'number' ? Math.min(1, Math.max(0, stored.volume)) : DEFAULTS.volume
    return { ...DEFAULTS, ...stored, tones: resolveTones(stored.tones), volume }
  } catch {
    return { ...DEFAULTS }
  }
}

type Permission = NotificationPermission | 'unsupported'

let lastBeep = 0

function beep(tone: ToneId, volume: number) {
  const now = Date.now()
  if (now - lastBeep < 1500) return // one sound per burst of messages
  lastBeep = now
  playTone(tone, volume)
}

/** Desktop notifications for this browser. Preferences live in localStorage (per device). */
export function useNotifier() {
  const prefs = useState<Prefs>('notify-prefs', loadPrefs)
  const permission = useState<Permission>('notify-permission', () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.value))
    } catch {
      // private mode etc.: preferences just won't persist
    }
  }

  function set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    prefs.value = { ...prefs.value, [key]: value }
    save()
  }

  /** Ask the browser for permission. Must be called from a click. */
  async function request(): Promise<Permission> {
    if (typeof Notification === 'undefined') return 'unsupported'
    const result = await Notification.requestPermission()
    permission.value = result
    if (result === 'granted') set('enabled', true)
    return result
  }

  const supported = computed(() => permission.value !== 'unsupported')
  const canAsk = computed(() => permission.value === 'default' && !prefs.value.dismissed)
  const active = computed(() => prefs.value.enabled && permission.value === 'granted')

  /** Show a notification. Resolves to an error message if the browser refused (for the test button). */
  async function show(opts: {
    channelId: string
    title: string
    body: string
    url?: string
    forcePreview?: boolean
    /** which tone to play; defaults to the channel-message tone */
    category?: ToneCategory
  }): Promise<string | null> {
    if (!active.value) return 'Notifications are switched off or not allowed for this site.'
    const options = {
      body: prefs.value.preview || opts.forcePreview ? opts.body : 'New message',
      tag: opts.channelId, // a newer message in the same channel replaces the older one
      silent: true, // we play our own sound so it can be switched off
      // Without this a notification that replaces an earlier one with the same tag is shown silently.
      renotify: true,
    } as NotificationOptions
    const url = opts.url ?? `/c/${opts.channelId}`
    try {
      const n = new Notification(opts.title, options)
      n.onclick = () => {
        desktopBridge()?.showWindow?.() // the desktop app's window may be hidden in the tray
        window.focus()
        navigateTo(url)
        n.close()
      }
    } catch (e) {
      // Android Chrome (and installed PWAs) refuse `new Notification()`: they only allow showing one through
      // the service worker, whose click handler takes you to the conversation.
      try {
        const registration = await navigator.serviceWorker?.getRegistration()
        if (!registration) return e instanceof Error ? e.message : String(e)
        await registration.showNotification(opts.title, { ...options, data: { url } })
      } catch (e2) {
        return e2 instanceof Error ? e2.message : String(e2)
      }
    }
    chime(opts.category)
    return null
  }

  /** Fire a sample notification right now, regardless of focus, to check the whole chain. */
  function test(): Promise<string | null> {
    return show({ channelId: 'test', title: 'CompanyChat', body: 'This is a test notification.', url: '/', forcePreview: true })
  }

  /** Just the sound (used when a background push shows the visual notification instead). */
  function chime(category: ToneCategory = 'channel') {
    if (prefs.value.sound) beep(prefs.value.tones[category], prefs.value.volume)
  }

  function setTone(category: ToneCategory, tone: ToneId) {
    set('tones', { ...prefs.value.tones, [category]: tone })
  }

  /** Play a tone now (settings preview): ignores the sound switch and the burst limit. */
  function preview(tone: ToneId, volume = prefs.value.volume) {
    playTone(tone, volume)
  }

  return { prefs, permission, supported, canAsk, active, set, setTone, request, show, test, chime, preview }
}
