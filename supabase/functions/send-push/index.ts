// Sends a push notification for an alert to every subscribed device.
// Secrets (set once):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) return json({ error: 'Not signed in' }, 401)
    const { data: caller } = await admin.from('profiles').select('role, is_active').eq('id', auth.user.id).maybeSingle()
    if (!caller?.is_active || caller.role !== 'admin') return json({ error: 'Not allowed' }, 403)

    const { alert_id } = await req.json()
    const { data: alert } = await admin.from('alerts').select('title, message').eq('id', alert_id).maybeSingle()
    if (!alert) return json({ error: 'Alert not found' }, 404)

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )

    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth')
    const payload = JSON.stringify({
      title: alert.title,
      body: alert.message.length > 140 ? alert.message.slice(0, 137) + '...' : alert.message,
      url: '/teacher/alerts',
    })

    let sent = 0
    const dead: string[] = []
    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
          sent++
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) dead.push(s.id)
        }
      }),
    )
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
    return json({ sent, removed: dead.length })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
