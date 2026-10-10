// 11:00 AM (weekdays): remind staff who have not clocked in, and class teachers who have not marked their register.
// Attendance closes at 12:00 noon. Runs from the scheduler (secret) or an admin pressing "run now" (force).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json, normalisePhone, pushToUsers, sendSmsEach } from '../_shared/notify.ts'

const STAFF_ROLES = ['teacher', 'bursar', 'headteacher', 'storekeeper']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const secret = Deno.env.get('BACKUP_SECRET')
    const viaCron = !!secret && req.headers.get('x-backup-secret') === secret
    if (!viaCron) {
      const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
      const { data: auth } = await admin.auth.getUser(token)
      if (!auth.user) return json({ error: 'Not signed in' }, 401)
      const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', auth.user.id).maybeSingle()
      if (!me?.is_active || me.role !== 'admin') return json({ error: 'Not allowed' }, 403)
    }
    const body = await req.json().catch(() => ({}))
    const force = !!body.force && !viaCron

    const accra = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Accra' }))
    const today = `${accra.getFullYear()}-${String(accra.getMonth() + 1).padStart(2, '0')}-${String(accra.getDate()).padStart(2, '0')}`
    const dow = accra.getDay()
    if (!force && (dow === 0 || dow === 6)) return json({ skipped: 'weekend' })

    if (!force) {
      const { error: dup } = await admin.from('reminder_runs').insert({ run_date: today })
      if (dup) return json({ skipped: 'already sent today' })
    }

    // Staff who have not clocked in
    const [{ data: staff }, { data: clocked }] = await Promise.all([
      admin.from('profiles').select('id, full_name, username, phone_number').in('role', STAFF_ROLES).eq('is_active', true),
      admin.from('staff_attendance').select('teacher_id').eq('date', today),
    ])
    const clockedIds = new Set((clocked ?? []).map((r) => r.teacher_id))
    const notClocked = new Set((staff ?? []).filter((s) => !clockedIds.has(s.id)).map((s) => s.id))

    // Classes whose register has not been taken
    const [{ data: classes }, { data: students }, { data: marked }] = await Promise.all([
      admin.from('classes').select('id, name, teacher_id').not('teacher_id', 'is', null),
      admin.from('students').select('class_id').eq('is_active', true).limit(5000),
      admin.from('attendance').select('class_id').eq('date', today).limit(5000),
    ])
    const hasStudents = new Set((students ?? []).map((s) => s.class_id))
    const hasMarks = new Set((marked ?? []).map((m) => m.class_id))
    const missingClass = new Map<string, string[]>() // teacher -> class names
    for (const c of classes ?? []) {
      if (hasStudents.has(c.id) && !hasMarks.has(c.id)) missingClass.set(c.teacher_id, [...(missingClass.get(c.teacher_id) ?? []), c.name])
    }

    const byId = new Map((staff ?? []).map((s) => [s.id, s]))
    const toRemind = new Set([...notClocked, ...[...missingClass.keys()].filter((id) => byId.has(id))])
    const items: { id: string; phone: string | null; text: string }[] = []
    for (const id of toRemind) {
      const person = byId.get(id)
      if (!person) continue
      const tasks: string[] = []
      if (notClocked.has(id)) tasks.push('clock in (staff sign-in)')
      if (missingClass.has(id)) tasks.push(`mark the attendance for ${missingClass.get(id)!.join(' and ')}`)
      items.push({ id, phone: normalisePhone(person.phone_number), text: `Reminder: please ${tasks.join(' and ')}. Attendance closes at 12:00 noon today.` })
    }

    // Dashboard alert for those people
    if (items.length) {
      const row = {
        title: 'Attendance reminder',
        message: 'Please clock in and mark your class attendance now. Attendance closes at 12:00 noon today.',
        audience: 'selected',
        target_ids: items.map((i) => i.id),
        sender_role: 'system',
        recipient_count: items.length,
      }
      const first = await admin.from('alerts').insert({ ...row, created_by: null })
      if (first.error) {
        const { data: a } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle()
        if (a) await admin.from('alerts').insert({ ...row, created_by: a.id })
      }
    }

    // Phone notifications and SMS (each person gets the wording for what they still need to do)
    let pushSent = 0
    for (const it of items) pushSent += await pushToUsers(admin, [it.id], { title: 'Attendance reminder', body: it.text, url: '/' }).catch(() => 0)
    const withPhone = items.filter((i) => i.phone) as { id: string; phone: string; text: string }[]
    const sms = await sendSmsEach(withPhone.map((i) => ({ phone: i.phone, text: `SAT Royal: ${i.text}` })))
    if (withPhone.length) {
      await admin.from('sms_broadcasts').insert({
        sender_name: 'System',
        audience: 'Attendance reminder',
        message: 'Attendance reminder (11:00 AM)',
        total: withPhone.length,
        sent: sms.sent,
        failed: sms.failed.length,
        failed_numbers: sms.failed.length ? sms.failed : null,
      })
    }

    const summary = { reminded: items.length, notClockedIn: notClocked.size, registersMissing: missingClass.size, pushSent, smsSent: sms.sent, smsFailed: sms.failed.length, noPhone: items.length - withPhone.length }
    if (!force) await admin.from('reminder_runs').update({ summary }).eq('run_date', today)
    return json(summary)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
