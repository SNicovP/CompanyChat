// Safety net for invite and password-reset links. Supabase puts the session in the URL hash
// (#access_token=...&type=invite). If the link lands on any page other than /confirm (for example when
// the redirect URL is not on the Supabase allow-list and Supabase falls back to the Site URL), the login
// redirect would throw the hash away and the person would see the login page instead of choosing a password.
// Forward the link to /confirm before the app starts, keeping the hash so the session is still picked up.
export default defineNuxtPlugin({
  name: 'invite-redirect',
  enforce: 'pre',
  setup() {
    const { pathname, hash } = window.location
    if (pathname.startsWith('/confirm') || pathname.startsWith('/set-password')) return
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const type = params.get('type')
    if (params.has('access_token') && (type === 'invite' || type === 'recovery')) {
      window.location.replace(`/confirm?next=set-password${hash}`)
    }
  },
})
