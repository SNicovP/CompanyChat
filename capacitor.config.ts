import type { CapacitorConfig } from '@capacitor/cli'

// The Android app bundles the static Nuxt build (npm run generate -> .output/public).
// Android serves it from https://localhost, so the API must allow that origin (CORS_ALLOWED_ORIGINS).
const config: CapacitorConfig = {
  appId: 'africa.ncloud.companychat',
  appName: 'CompanyChat',
  webDir: '.output/public',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0f172a' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
