// Sends the guardian an SMS for a fee payment via Arkesel.
// The API key stays here on the server. The browser only sends a receipt number.
//
// Secrets (set once):  supabase secrets set ARKESEL_API_KEY=... ARKESEL_SENDER_ID=...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Ghana numbers: 0241234567, 241234567, +233241234567 -> 233241234567
function normalisePhone(raw: string | null): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('233') && d.length === 12) return d
  if (d.startsWith('0') && d.length === 10) return '233' + d.slice(1)
  if (d.length === 9) return '233' + d
  return null
}

const cedis = (n: number) => 'GHS ' + n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Only a signed-in bursar or admin may trigger a text
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) return json({ error: 'Not signed in' }, 401)
    const { data: caller } = await admin.from('profiles').select('role, is_active, full_name, username, email').eq('id', auth.user.id).maybeSingle()
    if (!caller || !caller.is_active || !['bursar', 'admin'].includes(caller.role)) return json({ error: 'Not allowed' }, 403)

    const { receipt_no } = await req.json()
    if (!receipt_no) return json({ error: 'receipt_no is required' }, 400)

    // Every SMS outcome goes in the audit log, under the person who triggered it
    const audit = (action: 'sms.sent' | 'sms.failed', summary: string, entityId: string, details: Record<string, unknown>) =>
      admin.from('audit_logs').insert({
        actor_id: auth.user.id,
        actor_name: caller.full_name ?? caller.username ?? caller.email,
        actor_role: caller.role,
        action,
        entity_type: 'fee_payment',
        entity_id: entityId,
        summary,
        details: { receipt_no, ...details },
      })
    const masked = (n: string) => n.slice(0, 3) + '****' + n.slice(-3)

    const { data: pay } = await admin
      .from('fee_payments')
      .select('id, amount, status, student_id, fee_structure_id, students(full_name, guardian_phone), fee_structures(item, term, academic_year)')
      .eq('receipt_no', receipt_no)
      .maybeSingle()

    if (!pay) return json({ sent: false, reason: 'Receipt not found' })
    if (pay.status !== 'valid') return json({ sent: false, reason: 'Receipt is void' })

    const student = pay.students as { full_name: string | null; guardian_phone: string | null } | null
    const fee = pay.fee_structures as { item: string; term: string; academic_year: string } | null

    const to = normalisePhone(student?.guardian_phone ?? null)
    if (!student?.guardian_phone) {
      await audit('sms.failed', `SMS not sent for ${receipt_no}: no guardian phone number`, pay.id, { student: student?.full_name, reason: 'no_phone' })
      return json({ sent: false, reason: 'No guardian phone number on file' })
    }
    if (!to) {
      await audit('sms.failed', `SMS not sent for ${receipt_no}: guardian phone number is not valid`, pay.id, { student: student.full_name, reason: 'invalid_phone' })
      return json({ sent: false, reason: 'Guardian phone number is not valid' })
    }

    // All of this student's fee items: this term's breakdown plus any unpaid earlier terms
    const { data: bals } = await admin
      .from('student_fee_balances')
      .select('item, academic_year, term, balance')
      .eq('student_id', pay.student_id)
    const key = (y: string, t: string) => `${y}|${t}`
    const thisKey = key(fee?.academic_year ?? '', fee?.term ?? '')
    const rows = (bals ?? []).map((r) => ({ ...r, balance: Math.max(Number(r.balance ?? 0), 0), k: key(r.academic_year, r.term) }))
    const current = rows.filter((r) => r.k === thisKey).sort((x, y) => x.item.localeCompare(y.item))
    const arrears = rows.filter((r) => r.k < thisKey).reduce((sum, r) => sum + r.balance, 0)
    const total = current.reduce((sum, r) => sum + r.balance, 0) + arrears

    const name = (student.full_name ?? 'your ward').replace(/\s+/g, ' ').trim()
    // "GHS" instead of the cedi sign keeps the text in plain GSM-7
    const lines = [
      `SAT ROYAL BASIC SCHOOL: Received ${cedis(Number(pay.amount))} for ${name} (${fee?.item ?? 'fees'}, ${fee?.term ?? ''} ${fee?.academic_year ?? ''}).`,
      `Balance breakdown:`,
      ...current.map((r) => `${r.item}: ${cedis(r.balance)}`),
      ...(arrears > 0 ? [`Arrears: ${cedis(arrears)}`] : []),
      `Total balance: ${cedis(total)}`,
      `Receipt ${receipt_no}. Thank you.`,
    ]
    const sms = lines.join('\n')

    // Claim the receipt first (payment_id is the primary key), so a double click
    // or two tabs can never send twice. fee_payments itself is never touched.
    const { error: claimError } = await admin.from('fee_payment_sms').insert({ payment_id: pay.id })
    if (claimError) {
      return json({ sent: false, reason: claimError.code === '23505' ? 'SMS already sent for this receipt' : claimError.message })
    }

    const params = new URLSearchParams({
      action: 'send-sms',
      api_key: Deno.env.get('ARKESEL_API_KEY')!,
      to,
      from: Deno.env.get('ARKESEL_SENDER_ID') ?? 'SATROYAL',
      sms,
    })
    const res = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`)
    const out = await res.json().catch(() => ({}))

    if (!res.ok || out.code !== 'ok') {
      await admin.from('fee_payment_sms').delete().eq('payment_id', pay.id) // allow a retry
      await audit('sms.failed', `SMS to guardian failed for ${receipt_no}`, pay.id, {
        student: student.full_name,
        to: masked(to),
        reason: out.message ?? 'The SMS provider rejected the message',
      })
      return json({ sent: false, reason: out.message ?? 'The SMS provider rejected the message' })
    }

    await audit('sms.sent', `SMS sent to ${student.full_name ?? 'guardian'}'s guardian for ${receipt_no}`, pay.id, {
      student: student.full_name,
      to: masked(to),
    })
    return json({ sent: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})