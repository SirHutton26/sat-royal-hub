import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, BellRing, CheckCircle2, Loader2, Search, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { money } from '@/components/fees/fee-utils'

interface ClassRow { id: string; name: string }
interface Debtor { id: string; name: string; classId: string | null; className: string; phone: string | null; owed: number }
type Scope = 'all' | 'class' | 'pick'

const DEFAULT_MSG =
  'Dear Parent/Guardian, {student} has an outstanding school fees balance of GH₵ {amount}. Kindly make payment as soon as possible. Thank you. - SAT Royal Basic School'

// Supabase returns at most 1000 rows per request, so read in pages
async function readAll<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export default function BursarFeeReminders() {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [classId, setClassId] = useState('')
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState(DEFAULT_MSG)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          supabase.from('classes').select('id, name').order('name'),
          supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
        ])
        const cls = (c.data ?? []) as ClassRow[]
        setClasses(cls)
        const upTo = s.data?.current_academic_year && s.data?.current_term ? `${s.data.current_academic_year}|${s.data.current_term}` : '9999|'
        const [bal, stu] = await Promise.all([
          readAll<{ student_id: string; academic_year: string; term: string; balance: number }>((a, b) =>
            supabase.from('student_fee_balances').select('student_id, academic_year, term, balance').gt('balance', 0).range(a, b)),
          readAll<{ id: string; full_name: string; class_id: string | null; guardian_phone: string | null }>((a, b) =>
            supabase.from('students').select('id, full_name, class_id, guardian_phone').eq('is_active', true).order('full_name').range(a, b)),
        ])
        const owed = new Map<string, number>()
        for (const r of bal) if (`${r.academic_year}|${r.term}` <= upTo) owed.set(r.student_id, (owed.get(r.student_id) ?? 0) + Number(r.balance))
        const name = new Map(cls.map((x) => [x.id, x.name]))
        setDebtors(
          stu
            .filter((x) => (owed.get(x.id) ?? 0) > 0)
            .map((x) => ({ id: x.id, name: x.full_name, classId: x.class_id, className: name.get(x.class_id ?? '') ?? '', phone: x.guardian_phone, owed: owed.get(x.id) ?? 0 })),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load balances')
      }
      setLoading(false)
    })()
  }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return debtors.filter((d) => (scope !== 'class' || (classId && d.classId === classId)) && (!s || d.name.toLowerCase().includes(s)))
  }, [debtors, scope, classId, q])

  // "All" and "Class" start with everyone ticked (untick to exclude); "Pick" starts empty (tick to include)
  useEffect(() => {
    setResult('')
    setChecked(scope === 'pick' ? new Set() : new Set(debtors.filter((d) => scope === 'all' || (classId && d.classId === classId)).map((d) => d.id)))
  }, [scope, classId, debtors])

  const chosen = debtors.filter((d) => checked.has(d.id))
  const withPhone = chosen.filter((d) => d.phone && d.phone.replace(/\D/g, '').length >= 9)
  const total = chosen.reduce((t, d) => t + d.owed, 0)

  function toggle(id: string) {
    setChecked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const tickVisible = (on: boolean) =>
    setChecked((p) => {
      const n = new Set(p)
      visible.forEach((d) => (on ? n.add(d.id) : n.delete(d.id)))
      return n
    })

  async function send() {
    setError('')
    setResult('')
    if (!withPhone.length) return setError('Select at least one student with a guardian phone number')
    if (!message.trim()) return setError('Type a message first')
    const label = scope === 'all' ? 'All owing' : scope === 'class' ? classes.find((c) => c.id === classId)?.name ?? 'Class' : 'Selected students'
    if (!window.confirm(`Send fee reminders to the guardians of ${withPhone.length} student${withPhone.length === 1 ? '' : 's'}?`)) return
    setBusy(true)
    const { data, error: err } = await supabase.functions.invoke('send-fee-reminders', {
      body: { student_ids: withPhone.map((d) => d.id), message, label },
    })
    setBusy(false)
    if (err || data?.error) {
      let msg = data?.error ?? err?.message ?? 'Could not send'
      try {
        const j = await (err as unknown as { context: Response }).context.json()
        if (j?.error) msg = j.error
      } catch {
        /* keep message */
      }
      return setError(msg)
    }
    setResult(`Sent ${data.sent} of ${data.total} message${data.total === 1 ? '' : 's'}${data.failed ? ` (${data.failed} failed)` : ''}. Guardians of siblings get one combined text.`)
  }

  const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'
  const tabs: [Scope, string][] = [['all', 'Everyone owing'], ['class', 'A class'], ['pick', 'Pick students']]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-royal-900"><BellRing className="h-6 w-6" /> Fee Reminders</h1>
      <p className="mt-1 text-sm text-gray-500">Text guardians about the fees their wards still owe. Only students with a balance are listed.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setScope(k)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${scope === k ? 'bg-royal-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
        {scope === 'class' && (
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={input}>
            <option value="">Choose a class...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {scope === 'pick' ? 'Tick the students you want to remind.' : 'Everyone is ticked. Untick a student to leave them out.'}
      </p>

      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student" className={`${input} w-full pl-9`} />
          </div>
          <button onClick={() => tickVisible(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-royal-700 hover:bg-royal-50">Tick shown</button>
          <button onClick={() => tickVisible(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Untick shown</button>
        </div>

        <div className="mt-3 max-h-[45vh] overflow-auto">
          {loading ? (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-royal-600" />
          ) : scope === 'class' && !classId ? (
            <p className="py-8 text-center text-sm text-gray-500">Choose a class</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No students owing.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500">
                <tr><th className="w-10 py-2" /><th className="py-2">Student</th><th className="py-2">Class</th><th className="py-2 text-right">Owes</th></tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr key={d.id} onClick={() => toggle(d.id)} className="cursor-pointer border-t border-gray-100 hover:bg-royal-50/50">
                    <td className="py-2"><input type="checkbox" checked={checked.has(d.id)} onChange={() => toggle(d.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-royal-600" /></td>
                    <td className="py-2 font-medium text-royal-900">
                      {d.name}
                      {!(d.phone && d.phone.replace(/\D/g, '').length >= 9) && <span className="ml-2 text-[11px] font-normal text-amber-600">no phone</span>}
                    </td>
                    <td className="py-2 text-gray-500">{d.className}</td>
                    <td className="py-2 text-right font-semibold text-red-600">{money(d.owed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-royal-900">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={612} className={`${input} mt-1 w-full`} />
        <p className="mt-1 text-xs text-gray-500">{'{student}'} becomes the ward's name and {'{amount}'} what is owed. {message.length}/612</p>

        <p className="mt-3 text-sm text-gray-600">
          <b>{chosen.length}</b> selected · <b>{withPhone.length}</b> with a phone number · owing <b>{money(total)}</b>
        </p>

        {error && <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
        {result && <p className="mt-3 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {result}</p>}

        <button onClick={() => void send()} disabled={busy || !withPhone.length} className="mt-4 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send reminders
        </button>
      </div>
    </div>
  )
}
