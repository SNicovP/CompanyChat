// Admin-only user management that needs the service role key: invite, resend invite, password reset email, deactivate, reactivate.
// Deploy: npx supabase functions deploy admin-users --use-api
// Secret:  npx supabase secrets set SITE_URL=https://your-app-url   (used for the invite link)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { canChangeActive, canInvite, parseInvite, type AppRole } from '../_shared/policy.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Who is calling? Verified with their own token, never trusted from the body.
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) return json(401, { error: 'Not signed in.' })

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: actorProfile, error: actorError } = await admin
    .from('profiles')
    .select('id, app_role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (actorError) return json(500, { error: `Could not check your account: ${actorError.message}` })
  if (!actorProfile?.is_active) return json(403, { error: 'Your account is not active.' })
  const actor = { id: actorProfile.id as string, role: actorProfile.app_role as AppRole }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request.' })
  }

  const siteUrl = (Deno.env.get('SITE_URL') ?? 'http://localhost:3000').replace(/\/$/, '')
  const sendInvite = (email: string, displayName: string) =>
    admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/confirm?next=set-password`,
      data: { display_name: displayName },
    })
  const hasJoined = (u: { email_confirmed_at?: string | null; last_sign_in_at?: string | null }) => !!(u.email_confirmed_at || u.last_sign_in_at)

  // Which people have not accepted their invite yet (so the Users page can offer "Resend invite").
  if (body.action === 'pending') {
    const allowed = canInvite(actor.role)
    if (!allowed.ok) return json(403, { error: allowed.reason })
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (error) return json(500, { error: error.message })
    return json(200, { pending: data.users.filter((u) => !hasJoined(u)).map((u) => u.id) })
  }

  if (body.action === 'resend_invite') {
    const allowed = canInvite(actor.role)
    if (!allowed.ok) return json(403, { error: allowed.reason })
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    const { data, error: lookupError } = await admin.auth.admin.getUserById(targetId)
    if (lookupError || !data.user) return json(404, { error: 'User not found.' })
    const target = data.user
    if (hasJoined(target) || !target.email) return json(409, { error: 'That person has already joined, so there is no invite to resend.' })
    const name = typeof target.user_metadata?.display_name === 'string' ? target.user_metadata.display_name : target.email.split('@')[0]!
    const { error } = await sendInvite(target.email, name)
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true })
  }

  // For people who joined but never got to choose a password: email them a link to the set-password page.
  if (body.action === 'send_password_reset') {
    const allowed = canInvite(actor.role)
    if (!allowed.ok) return json(403, { error: allowed.reason })
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    const { data, error: lookupError } = await admin.auth.admin.getUserById(targetId)
    if (lookupError || !data.user?.email) return json(404, { error: 'User not found.' })
    if (!hasJoined(data.user)) return json(409, { error: 'That person has not accepted their invite yet. Resend the invite instead.' })
    const { error } = await admin.auth.resetPasswordForEmail(data.user.email, { redirectTo: `${siteUrl}/confirm?next=set-password` })
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true })
  }

  if (body.action === 'invite') {
    const allowed = canInvite(actor.role)
    if (!allowed.ok) return json(403, { error: allowed.reason })
    const parsed = parseInvite(body)
    if ('error' in parsed) return json(400, { error: parsed.error })

    const { error } = await sendInvite(parsed.email, parsed.display_name)
    if (error) {
      const taken = /already (been )?registered/i.test(error.message)
      return json(taken ? 409 : 400, { error: taken ? 'That email already has an account.' : error.message })
    }
    return json(200, { ok: true })
  }

  if (body.action === 'deactivate' || body.action === 'reactivate') {
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    const { data: target, error: targetError } = await admin.from('profiles').select('id, app_role').eq('id', targetId).maybeSingle()
    if (targetError) return json(500, { error: `Could not look up that user: ${targetError.message}` })
    if (!target) return json(404, { error: 'User not found.' })

    const allowed = canChangeActive(actor, { id: target.id as string, role: target.app_role as AppRole })
    if (!allowed.ok) return json(403, { error: allowed.reason })

    const deactivate = body.action === 'deactivate'
    // Ban first: if this fails nothing changes. 876000h is about 100 years.
    const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: deactivate ? '876000h' : 'none' })
    if (banError) return json(500, { error: banError.message })
    const { error: flagError } = await admin.from('profiles').update({ is_active: !deactivate }).eq('id', targetId)
    if (flagError) return json(500, { error: flagError.message })
    return json(200, { ok: true })
  }

  return json(400, { error: 'Unknown action.' })
})
