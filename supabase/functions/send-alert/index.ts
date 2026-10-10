// The headteacher (or admin) sends an alert to staff: it appears on their dashboard, goes to their phones, and is texted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json, normalisePhone, pushToUsers, sendSmsSame } from '../_shared/notify.ts'

const STAFF_ROLES = ['teacher', 'bursar', 'headteacher', 'storekeeper', 'staff', 'messenger']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) return json({ error: 'Not signed in' }, 401)
    const { data: me } = await admin.from('profiles').select('role, is_active, full_name, username').eq('id', auth.user.id).maybeSingle()
    if (!me?.is_active || !['headteacher', 'admin'].includes(me.role)) return json({ error: 'Not allowed' }, 403)

    const body = await req.json()
    const aud = body.audience as { type?: string; ids?: string[] } | undefined
    if (!aud?.type || !['all_staff', 'all_teachers', 'selected'].includes(aud.type)) return json({ error: 'Choose who the alert is for' }, 400)

    // Who gets it (decided here, never trusted from the browser)
    let q = admin.from('profiles').select('id, full_name, username, role, phone_number').eq('is_active', true).neq('id', auth.user.id)
    if (aud.type === 'all_teachers') q = q.eq('role', 'teacher')
    else if (aud.type === 'all_staff') q = q.in('role', STAFF_ROLES)
    else {
      if (!aud.ids?.length) return json({ error: 'Choose at least one person' }, 400)
      q = q.in('id', aud.ids).in('role', STAFF_ROLES)
    }
    const { data: people } = await q.limit(500)
    const recipients = people ?? []
    const phones = [...new Set(recipients.map((p) => normalisePhone(p.phone_number)).filter(Boolean) as string[])]

    if (body.action === 'preview') {
      return json({ total: recipients.length, withPhone: phones.length, names: recipients.slice(0, 5).map((p) => p.full_name || p.username) })
    }
    if (body.action !== 'send') return json({ error: 'Unknown action' }, 400)

    const title = String(body.title ?? '').trim()
    const message = String(body.message ?? '').trim()
    if (!title || !message) return json({ error: 'Type a title and a message' }, 400)
    if (title.length > 80) return json({ error: 'The title is too long (max 80 characters)' }, 400)
    if (message.length > 500) return json({ error: 'The message is too long (max 500 characters)' }, 400)
    if (!recipients.length) return json({ error: 'There is nobody to send this to' }, 400)

    const ids = recipients.map((p) => p.id)
    const { data: alert, error: aErr } = await admin
      .from('alerts')
      .insert({ title, message, created_by: auth.user.id, audience: 'selected', target_ids: ids, sender_role: me.role, recipient_count: ids.length })
      .select('id')
      .single()
    if (aErr) return json({ error: aErr.message }, 500)

    let pushSent = 0
    if (body.push !== false) {
      try {
        pushSent = await pushToUsers(admin, ids, { title, body: message.length > 140 ? message.slice(0, 137) + '...' : message, url: '/teacher/alerts' })
      } catch {
        /* the alert is still on their dashboards */
      }
    }

    let smsSent = 0
    let smsFailed = 0
    if (body.sms !== false && phones.length) {
      const text = `SAT Royal: ${title} - ${message}`.slice(0, 612)
      const r = await sendSmsSame(phones, text)
      smsSent = r.sent
      smsFailed = r.failed.length
      await admin.from('sms_broadcasts').insert({
        sent_by: auth.user.id,
        sender_name: me.full_name || me.username,
        audience: 'Staff alert',
        message: text,
        total: phones.length,
        sent: r.sent,
        failed: r.failed.length,
        failed_numbers: r.failed.length ? r.failed : null,
      })
    }

    await admin.from('alerts').update({ push_sent: pushSent, sms_sent: smsSent, sms_failed: smsFailed }).eq('id', alert.id)
    return json({ recipients: ids.length, pushSent, smsSent, smsFailed, noPhone: ids.length - phones.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
