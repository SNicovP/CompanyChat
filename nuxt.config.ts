// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Internal tool behind a login: no SEO needs, so run as an SPA.
  ssr: false,

  modules: ['@nuxt/ui', '@nuxtjs/supabase', '@pinia/nuxt'],

  css: ['~/assets/css/main.css'],

  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: [],
    },
  },
})
