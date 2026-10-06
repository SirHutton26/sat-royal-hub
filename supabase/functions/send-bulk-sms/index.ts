// Lets the messenger (or an admin) text parents and staff via Arkesel.
// Secrets: ARKESEL_API_KEY, ARKESEL_SENDER_ID (already set for send-receipt-sms)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function normalisePhone(raw: string | null): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('233') && d.length === 12) return d
  if (d.startsWith('0') && d.length === 10) return '233' + d.slice(1)
  if (d.length === 9) return '233' + d
  return null
}

interface Audience {
  type: 'all_parents' | 'class_parents' | 'students' | 'all_teachers' | 'all_staff' | 'teachers' | 'numbers'
  class_id?: string
  student_ids?: string[]
  teacher_ids?: string[]
  numbers?: string
  gender?: 'male' | 'female'
}
interface Recipient {
  phone: string
  name: string
}

const AUDIENCE_LABEL: Record<Audience['type'], string> = {
  all_parents: 'All parents',
  class_parents: 'Class parents',
  students: 'Selected parents',
  all_teachers: 'All teachers',
  all_staff: 'All staff',
  teachers: 'Selected teachers',
  numbers: 'Typed numbers',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) return json({ error: 'Not signed in' }, 401)
    const { data: caller } = await admin.from('profiles').select('role, is_active, full_name, username').eq('id', auth.user.id).maybeSingle()
    if (!caller?.is_active || !['messenger', 'admin'].includes(caller.role)) return json({ error: 'Not allowed' }, 403)

    const body = await req.json()
    const action = String(body.action ?? '')
    const apiKey = Deno.env.get('ARKESEL_API_KEY')!

    /* ---- lists for the screen ---- */
    if (action === 'meta') {
      const [{ data: classes }, { data: teachers }] = await Promise.all([
        admin.from('classes').select('id, name').order('name'),
        admin.from('profiles').select('id, full_name, username, phone_number').eq('role', 'teacher').eq('is_active', true).order('full_name'),
      ])
      let balance: number | null = null
      try {
        const r = await fetch(`https://sms.arkesel.com/sms/api?action=check-balance&api_key=${apiKey}&response=json`)
        const j = await r.json()
        if (j?.balance !== undefined) balance = Number(j.balance)
      } catch {
        /* balance is optional */
      }
      return json({
        classes: classes ?? [],
        teachers: (teachers ?? []).map((t) => ({ id: t.id, name: t.full_name || t.username || 'Teacher', hasPhone: !!normalisePhone(t.phone_number) })),
        balance,
      })
    }
    if (action === 'search') {
      const q = String(body.q ?? '').trim()
      if (q.length < 2) return json({ students: [] })
      const { data } = await admin
        .from('students')
        .select('id, full_name, guardian_phone, classes(name)')
        .eq('is_active', true)
        .ilike('full_name', `%${q}%`)
        .order('full_name')
        .limit(20)
      return json({
        students: (data ?? []).map((s) => ({
          id: s.id,
          name: s.full_name,
          className: (s.classes as { name?: string } | null)?.name ?? '',
          hasPhone: !!normalisePhone(s.guardian_phone),
        })),
      })
    }

    /* ---- build the recipient list (done here, never trusted from the browser) ---- */
    const a = body.audience as Audience
    if (!a || !(a.type in AUDIENCE_LABEL)) return json({ error: 'Choose who to send to' }, 400)
    const byPhone = new Map<string, string[]>()
    let noPhone = 0
    let noGender = 0
    const g = a.gender === 'male' || a.gender === 'female' ? a.gender : null
    const keep = (rowGender: string | null) => {
      if (!g) return true
      if (!rowGender) return void noGender++ || false
      return rowGender.toLowerCase() === g
    }
    const add = (raw: string | null, name: string) => {
      const p = normalisePhone(raw)
      if (!p) return void noPhone++
      byPhone.set(p, [...(byPhone.get(p) ?? []), name])
    }

    if (['all_parents', 'class_parents', 'students'].includes(a.type)) {
      let q = admin.from('students').select('full_name, guardian_phone, gender').eq('is_active', true)
      if (a.type === 'class_parents') {
        if (!a.class_id) return json({ error: 'Choose a class' }, 400)
        q = q.eq('class_id', a.class_id)
      }
      if (a.type === 'students') {
        if (!a.student_ids?.length) return json({ error: 'Choose at least one student' }, 400)
        q = q.in('id', a.student_ids)
      }
      const { data } = await q.limit(5000)
      for (const s of data ?? []) if (a.type === 'students' || keep(s.gender)) add(s.guardian_phone, String(s.full_name ?? '').replace(/\s+/g, ' ').trim())
    } else if (['all_teachers', 'all_staff', 'teachers'].includes(a.type)) {
      let q = admin.from('profiles').select('full_name, username, phone_number, gender').eq('is_active', true)
      if (a.type === 'all_teachers') q = q.eq('role', 'teacher')
      if (a.type === 'all_staff') q = q.in('role', ['teacher', 'bursar', 'staff'])
      if (a.type === 'teachers') {
        if (!a.teacher_ids?.length) return json({ error: 'Choose at least one teacher' }, 400)
        q = q.in('id', a.teacher_ids)
      }
      const { data } = await q.limit(1000)
      for (const t of data ?? []) if (a.type === 'teachers' || keep(t.gender)) add(t.phone_number, String(t.full_name || t.username || '').trim())
    } else {
      for (const n of String(a.numbers ?? '').split(/[\s,;]+/).filter(Boolean)) add(n, '')
    }

    const recipients: Recipient[] = [...byPhone.entries()].map(([phone, names]) => ({ phone, name: [...new Set(names)].join(' & ') }))
    if (action === 'preview') {
      return json({ total: recipients.length, noPhone, noGender, sample: recipients.slice(0, 5).map((r) => r.name || r.phone) })
    }
    if (action !== 'send') return json({ error: 'Unknown action' }, 400)

    const message = String(body.message ?? '').trim()
    if (!message) return json({ error: 'Type a message first' }, 400)
    if (message.length > 612) return json({ error: 'Message is too long (max 612 characters)' }, 400)
    if (!recipients.length) return json({ error: 'No valid phone numbers for this selection' }, 400)
    if (recipients.length > 1500) return json({ error: 'Too many recipients at once (max 1500)' }, 400)

    const sender = Deno.env.get('ARKESEL_SENDER_ID') ?? 'SATROYAL'
    const send = async (to: string, sms: string) => {
      const params = new URLSearchParams({ action: 'send-sms', api_key: apiKey, to, from: sender, sms })
      try {
        const res = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`)
        const out = await res.json().catch(() => ({}))
        return res.ok && out.code === 'ok'
      } catch {
        return false
      }
    }

    const personal = /\{(student|teacher|name)\}/i.test(message)
    const failedNumbers: string[] = []
    let sent = 0
    if (personal) {
      // One text each so the name can be filled in
      const queue = [...recipients]
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          for (let r = queue.shift(); r; r = queue.shift()) {
            const who = r.name || (['all_parents', 'class_parents', 'students'].includes(a.type) ? 'your ward' : 'Sir/Madam')
            const ok = await send(r.phone, message.replace(/\{(student|teacher|name)\}/gi, who))
            if (ok) sent++
            else failedNumbers.push(r.phone)
          }
        }),
      )
    } else {
      for (let i = 0; i < recipients.length; i += 50) {
        const chunk = recipients.slice(i, i + 50).map((r) => r.phone)
        if (await send(chunk.join(','), message)) sent += chunk.length
        else failedNumbers.push(...chunk)
      }
    }

    const label =
      a.type === 'class_parents'
        ? `Parents of ${((await admin.from('classes').select('name').eq('id', a.class_id!).maybeSingle()).data?.name as string) ?? 'a class'}`
        : AUDIENCE_LABEL[a.type]
    const who = a.type.includes('teacher') || a.type === 'all_staff' ? ['male', 'female'] : ['boys', 'girls']
    const gLabel = g ? ` (${who[g === 'male' ? 0 : 1]} only)` : ''
    await admin.from('sms_broadcasts').insert({
      sent_by: auth.user.id,
      sender_name: caller.full_name || caller.username,
      audience: label + (['all_parents', 'class_parents', 'all_teachers', 'all_staff'].includes(a.type) ? gLabel : ''),
      message,
      total: recipients.length,
      sent,
      failed: failedNumbers.length,
      failed_numbers: failedNumbers.length ? failedNumbers : null,
    })
    return json({ total: recipients.length, sent, failed: failedNumbers.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
