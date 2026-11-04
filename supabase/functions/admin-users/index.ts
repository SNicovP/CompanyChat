// Admin-only user management that needs the service role key: invite, deactivate, reactivate.
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

  if (body.action === 'invite') {
    const allowed = canInvite(actor.role)
    if (!allowed.ok) return json(403, { error: allowed.reason })
    const parsed = parseInvite(body)
    if ('error' in parsed) return json(400, { error: parsed.error })

    const siteUrl = (Deno.env.get('SITE_URL') ?? 'http://localhost:3000').replace(/\/$/, '')
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.email, {
      redirectTo: `${siteUrl}/confirm?next=set-password`,
      data: { display_name: parsed.display_name },
    })
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
