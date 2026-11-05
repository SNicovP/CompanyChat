// Sends Web Push notifications for new messages. Called by a Database Webhook on messages INSERT
// (Dashboard -> Database -> Webhooks), not by browsers. See the "Background notifications" README section.
// Deploy: npx supabase functions deploy send-push --use-api --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), PUSH_WEBHOOK_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildPush, type PushKind } from '../_shared/push.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Constant-time comparison so the shared secret cannot be guessed byte by byte.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const expected = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
  const given = req.headers.get('x-webhook-secret') ?? ''
  if (!expected || !sameSecret(given, expected)) return json(401, { error: 'Unauthorized' })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) return json(500, { error: 'VAPID secrets are not set.' })
  webpush.setVapidDetails(subject, publicKey, privateKey)

  let payload: { type?: string; table?: string; record?: { id?: string } }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  if (payload.type !== 'INSERT' || payload.table !== 'messages' || !payload.record?.id) return json(200, { skipped: 'not a message insert' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: msg, error: msgError } = await db.from('messages').select('id, channel_id, user_id, body').eq('id', payload.record.id).maybeSingle()
  if (msgError) return json(500, { error: msgError.message })
  if (!msg) return json(200, { skipped: 'message is gone' })

  const { data: targets, error: targetError } = await db.rpc('push_targets', { mid: msg.id })
  if (targetError) return json(500, { error: targetError.message })
  if (!targets?.length) return json(200, { sent: 0 })

  const userIds = (targets as { user_id: string; kind: PushKind }[]).map((t) => t.user_id)
  const kindOf = new Map((targets as { user_id: string; kind: PushKind }[]).map((t) => [t.user_id, t.kind]))

  const [{ data: subs }, { data: channel }, { data: people }] = await Promise.all([
    db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, show_preview').in('user_id', userIds),
    db.from('channels').select('id, kind, name').eq('id', msg.channel_id).maybeSingle(),
    db.from('profiles').select('id, display_name'),
  ])
  if (!channel || !subs?.length) return json(200, { sent: 0 })

  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]))
  const nameOf = (id: string) => names.get(id) ?? 'Unknown'

  let sent = 0
  const expired: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      const note = buildPush({
        kind: kindOf.get(s.user_id)!,
        channelId: channel.id,
        channelKind: channel.kind,
        channelName: channel.name,
        senderName: msg.user_id ? nameOf(msg.user_id) : 'Someone',
        body: msg.body ?? '',
        showPreview: s.show_preview,
        nameOf,
      })
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(note), { TTL: 3600, urgency: 'high' })
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) expired.push(s.id) // browser unsubscribed: forget it
        else console.error('push failed', status, (e as Error).message)
      }
    }),
  )
  if (expired.length) await db.from('push_subscriptions').delete().in('id', expired)

  return json(200, { sent, expired: expired.length })
})
