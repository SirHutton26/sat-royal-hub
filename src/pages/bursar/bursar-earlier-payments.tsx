import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileDown, Loader2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/components/fees/fee-utils'
import { fetchAll } from '@/lib/headteacher'
import { localISO } from '@/lib/attendance'
import { matchStudent, normClass, parseList, type Stu } from '@/lib/earlier-payments'

interface Line {
  id: number
  name: string
  cls: string
  amount: string
  studentId: string | null
  saved?: boolean
  error?: string
}
interface FeeOpt {
  key: string
  item: string
  term: string
  year: string
}
interface Bal {
  student_id: string
  fee_structure_id: string
  amount_due: number | string
  amount_paid: number | string
  balance: number | string
}

const box = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function BursarEarlierPayments() {
  const { profile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [students, setStudents] = useState<Stu[]>([])
  const [fees, setFees] = useState<FeeOpt[]>([])
  const [feeKey, setFeeKey] = useState('')
  const [date, setDate] = useState(localISO())
  const [text, setText] = useState('')
  const [lines, setLines] = useState<Line[] | null>(null)
  const [bals, setBals] = useState<Map<string, Bal>>(new Map())
  const [already, setAlready] = useState<{ n: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState<{ ok: number; failed: number } | null>(null)

  const fee = fees.find((f) => f.key === feeKey) ?? null

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('id, name').order('name'),
      fetchAll<Stu>((a, b) => supabase.from('students').select('id, full_name, admission_number, class_id').eq('is_active', true).order('full_name').range(a, b)),
      supabase.from('fee_structures').select('item, term, academic_year').order('academic_year', { ascending: false }),
      supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
    ]).then(([c, s, f, set]) => {
      setClasses((c.data ?? []) as { id: string; name: string }[])
      setStudents(s)
      const seen = new Map<string, FeeOpt>()
      for (const r of f.data ?? []) {
        const key = `${r.item}|${r.term}|${r.academic_year}`
        if (!seen.has(key)) seen.set(key, { key, item: r.item, term: r.term, year: r.academic_year })
      }
      const list = [...seen.values()].sort((a, b) => b.year.localeCompare(a.year) || b.term.localeCompare(a.term) || a.item.localeCompare(b.item))
      setFees(list)
      const cur = list.find((x) => /school fee/i.test(x.item) && x.term === set.data?.current_term && x.year === set.data?.current_academic_year)
      setFeeKey((cur ?? list[0])?.key ?? '')
    })
  }, [])

  // what each student owes for the chosen fee, and what was already entered as "before system"
  useEffect(() => {
    if (!fee) return
    let alive = true
    fetchAll<Bal>((a, b) =>
      supabase.from('student_fee_balances').select('student_id, fee_structure_id, amount_due, amount_paid, balance').eq('item', fee.item).eq('term', fee.term).eq('academic_year', fee.year).range(a, b),
    ).then((rows) => alive && setBals(new Map(rows.map((r) => [r.student_id, r]))))
    supabase
      .from('fee_payments')
      .select('amount, fee_structures!inner(item, term, academic_year)')
      .eq('source', 'before_system')
      .eq('status', 'valid')
      .eq('fee_structures.item', fee.item)
      .eq('fee_structures.term', fee.term)
      .eq('fee_structures.academic_year', fee.year)
      .then(({ data }) => alive && setAlready({ n: data?.length ?? 0, total: (data ?? []).reduce((s, r) => s + Number(r.amount), 0) }))
    return () => {
      alive = false
    }
  }, [fee])

  const classIds = useMemo(() => new Map(classes.map((c) => [normClass(c.name), c.id])), [classes])
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])

  function check(source: string) {
    setError('')
    setFinished(null)
    const rows = parseList(source)
    if (!rows.length) return setError('Nothing to read. Each line needs a name, a class and an amount.')
    if (!fee) return setError('Choose the fee first')
    setLines(rows.map((r, i) => ({ id: i, ...r, studentId: matchStudent(r, students, classIds) })))
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const t = await f.text()
    setText(t)
    check(t)
  }

  // work out the state of each line (the amounts of the same student add up)
  const view = useMemo(() => {
    const running = new Map<string, number>()
    return (lines ?? []).map((l) => {
      const st = l.studentId ? byId.get(l.studentId) : undefined
      const b = l.studentId ? bals.get(l.studentId) : undefined
      const amt = Number(l.amount)
      let status: 'done' | 'failed' | 'pick' | 'nofee' | 'amount' | 'over' | 'ready' = 'ready'
      let note = ''
      if (l.saved) status = 'done'
      else if (l.error) {
        status = 'failed'
        note = l.error
      } else if (!st) status = 'pick'
      else if (!b) status = 'nofee'
      else if (!(amt > 0)) status = 'amount'
      else {
        const left = Number(b.balance) - (running.get(st.id) ?? 0)
        if (amt > left + 0.001) {
          status = 'over'
          note = `Only ${money(Math.max(left, 0))} left`
        } else running.set(st.id, (running.get(st.id) ?? 0) + amt)
      }
      return { l, st, b, amt, status, note }
    })
  }, [lines, byId, bals])

  const ready = view.filter((v) => v.status === 'ready')
  const readyTotal = ready.reduce((s, v) => s + v.amt, 0)
  const attention = view.filter((v) => !['ready', 'done'].includes(v.status)).length

  const setLine = (id: number, patch: Partial<Line>) => setLines((ls) => (ls ?? []).map((x) => (x.id === id ? { ...x, ...patch, error: undefined } : x)))

  async function save() {
    if (!profile || !fee || !ready.length) return
    if (!navigator.onLine) return setError('You need internet to save these payments.')
    if (!confirm(`Save ${ready.length} earlier payments totalling ${money(readyTotal)} for ${fee.item}, ${fee.term} ${fee.year}?`)) return
    setBusy(true)
    setError('')
    setProgress(0)
    const paidAt = date === localISO() ? new Date().toISOString() : `${date}T12:00:00.000Z`
    let ok = 0
    let failed = 0
    for (const v of ready) {
      const { error: err } = await supabase.from('fee_payments').insert({
        student_id: v.st!.id,
        fee_structure_id: v.b!.fee_structure_id,
        amount: v.amt,
        method: 'cash',
        note: 'Paid before the system',
        paid_at: paidAt,
        received_by: profile.id,
        status: 'valid',
        source: 'before_system',
      })
      if (err) {
        failed++
        setLines((ls) => (ls ?? []).map((x) => (x.id === v.l.id ? { ...x, error: err.message } : x)))
      } else {
        ok++
        setLines((ls) => (ls ?? []).map((x) => (x.id === v.l.id ? { ...x, saved: true } : x)))
      }
      setProgress((p) => p + 1)
    }
    setBusy(false)
    setFinished({ ok, failed })
    // refresh what is owed
    if (fee) {
      const rows = await fetchAll<Bal>((a, b) => supabase.from('student_fee_balances').select('student_id, fee_structure_id, amount_due, amount_paid, balance').eq('item', fee.item).eq('term', fee.term).eq('academic_year', fee.year).range(a, b))
      setBals(new Map(rows.map((r) => [r.student_id, r])))
    }
  }

  function template() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['Name,Class,Amount\nTUGAH HANSON,Basic 7,100\n'], { type: 'text/csv' }))
    a.download = 'earlier-payments-list.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const chip: Record<string, string> = {
    ready: 'bg-green-50 text-green-700',
    done: 'bg-royal-50 text-royal-700',
    pick: 'bg-amber-50 text-amber-700',
    nofee: 'bg-red-50 text-red-700',
    amount: 'bg-red-50 text-red-700',
    over: 'bg-red-50 text-red-700',
    failed: 'bg-red-50 text-red-700',
  }
  const label = (s: string, fee: FeeOpt | null) =>
    ({ ready: 'Ready', done: 'Saved', pick: 'Choose student', nofee: `No ${fee?.item ?? 'fee'} for this student`, amount: 'Check amount', over: 'More than balance', failed: 'Not saved' })[s] ?? s

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Earlier payments</h1>
      <p className="mt-1 text-sm text-gray-500">
        Enter what parents paid <b>before we started using the system</b>, so their balances are correct. These are marked <b>"Before system"</b>, are not counted in today's collection, no SMS is sent, and no official receipt is printed.
      </p>

      {!finished && (
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-royal-900">
              Which fee did they pay?
              <select value={feeKey} onChange={(e) => { setFeeKey(e.target.value); setLines(null) }} className={`${box} mt-1 w-full`}>
                {fees.map((f) => (
                  <option key={f.key} value={f.key}>{f.item} - {f.term}, {f.year}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-royal-900">
              Date to record
              <input type="date" value={date} max={localISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${box} mt-1 w-full`} />
            </label>
          </div>

          {already && already.n > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Already entered for this fee: <b>{already.n}</b> earlier payments, {money(already.total)}. Do not enter the same students again.
            </p>
          )}

          <p className="mt-4 text-sm font-medium text-royal-900">Your list: name, class and amount paid</p>
          <p className="text-xs text-gray-500">In Excel, select the three columns, copy, and paste here. Or upload a CSV file. One student per line.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'TUGAH HANSON    Basic 7    100\nABAYATEYE ANITA    Basic 7    50'} className={`${box} mt-2 w-full font-mono`} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => check(text)} disabled={!text.trim()} className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-50">
              Check the list
            </button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-royal-200 px-3 py-2 text-sm font-semibold text-royal-700 hover:bg-royal-50">
              <Upload className="h-4 w-4" /> Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
            <button onClick={template} className="flex items-center gap-1.5 px-2 py-2 text-xs font-medium text-gray-500 hover:text-gray-700">
              <FileDown className="h-4 w-4" /> Blank list
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}

      {finished && (
        <p className={`mt-5 flex items-start gap-2 rounded-lg px-3 py-3 text-sm ${finished.failed ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {finished.ok} earlier payment(s) saved{finished.failed ? `, ${finished.failed} could not be saved (see below)` : ''}. They now show on the Receipts page marked "Before system".
        </p>
      )}

      {lines && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">
              <b className="text-green-700">{ready.length}</b> ready ({money(readyTotal)})
              {attention > 0 && <> · <b className="text-amber-700">{attention}</b> need attention</>}
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setLines(null); setFinished(null); setText('') }} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                {finished ? 'Enter another list' : 'Start over'}
              </button>
              {!finished || ready.length > 0 ? (
                <button onClick={save} disabled={busy || ready.length === 0} className="flex items-center gap-2 rounded-lg bg-gold-400 px-4 py-2 text-sm font-bold text-royal-900 hover:bg-gold-500 disabled:opacity-50">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy ? `Saving ${progress}/${ready.length + progress}` : `Save ${ready.length} payments`}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th className="px-3 py-3 font-semibold">#</th>
                  <th className="px-3 py-3 font-semibold">On your list</th>
                  <th className="px-3 py-3 font-semibold">Student in the system</th>
                  <th className="px-3 py-3 text-right font-semibold">Fee</th>
                  <th className="w-28 px-3 py-3 text-right font-semibold">Paid</th>
                  <th className="px-3 py-3 text-right font-semibold">Balance after</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.map((v, i) => {
                  const pool = students.filter((s) => {
                    const cid = v.l.cls ? classIds.get(normClass(v.l.cls)) : undefined
                    return !cid || s.class_id === cid
                  })
                  const locked = v.status === 'done'
                  return (
                    <tr key={v.l.id} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2.5 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-royal-900">{v.l.name}</p>
                        <p className="text-xs text-gray-400">{v.l.cls}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <select value={v.l.studentId ?? ''} disabled={locked || busy} onChange={(e) => setLine(v.l.id, { studentId: e.target.value || null })} className={`${box} w-56 py-1.5`}>
                          <option value="">- choose -</option>
                          {pool.map((s) => (
                            <option key={s.id} value={s.id}>{s.full_name} ({className.get(s.class_id) ?? ''})</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{v.b ? Number(v.b.amount_due).toFixed(2) : '-'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <input inputMode="decimal" value={v.l.amount} disabled={locked || busy} onChange={(e) => setLine(v.l.id, { amount: e.target.value.replace(/[^\d.]/g, '') })} className={`${box} w-24 py-1.5 text-right`} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-royal-900">
                        {v.b && v.amt > 0 ? Math.max(Number(v.b.balance) - v.amt, 0).toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip[v.status]}`}>{label(v.status, fee)}</span>
                        {v.note && <p className="mt-1 text-xs text-gray-500">{v.note}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">Fix any line by choosing the right student or changing the amount. Lines that are not "Ready" are skipped when you save.</p>
        </>
      )}
    </div>
  )
}
