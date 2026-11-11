// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Internal tool behind a login: no SEO needs, so run as an SPA.
  ssr: false,

  modules: ['@nuxt/ui', '@nuxtjs/supabase', '@pinia/nuxt'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'theme-color', content: '#0f172a' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'CompanyChat' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      // Public Web Push (VAPID) key; set NUXT_PUBLIC_VAPID_PUBLIC_KEY at build time. Empty hides background notifications.
      vapidPublicKey: '',
    },
  },

  supabase: {
    // Send the realtime heartbeat from a Web Worker: background tabs and the hidden desktop window throttle
    // normal timers, the heartbeat goes late, the socket drops and live messages (and their notifications) are missed.
    clientOptions: { realtime: { worker: true } },
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      // Static hosting (Forge) redirects /confirm to /confirm/. The module matches paths exactly, so without
      // the trailing-slash forms the invite/reset landing page counts as protected and bounces to login.
      exclude: ['/confirm/', '/login/'],
    },
  },
})
