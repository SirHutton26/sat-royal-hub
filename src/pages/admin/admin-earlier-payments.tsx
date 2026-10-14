import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/components/fees/fee-utils'
import { localISO } from '@/lib/attendance'

interface Stu {
  id: string
  full_name: string
}
interface Bal {
  student_id: string
  fee_structure_id: string
  academic_year: string
  term: string
  item: string
  amount_due: number | string
  balance: number | string
}

const ARREARS = '__arrears__'
const box = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'
const COLS = 'student_id, fee_structure_id, academic_year, term, item, amount_due, balance'
const OPENING = 'Opening balance'
/** The term just before the selected one (where an opening balance is kept) */
function prevPeriod(year: string, term: string) {
  const n = Number(term.replace(/\D/g, '')) || 1
  if (n > 1) return { year, term: `Term ${n - 1}` }
  const y = Number(year.split('/')[0]) - 1
  return { year: `${y}/${y + 1}`, term: 'Term 3' }
}
const periodKey = (y: string, t: string) => `${y}|${t}`

/** School Fees first, then Exams, then anything else A-Z (the order on the bursar's sheet) */
const itemRank = (s: string) => (/school/i.test(s) ? 0 : /exam/i.test(s) ? 1 : 2)

export default function AdminEarlierPayments() {
  const { profile } = useAuth()
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [classId, setClassId] = useState('')
  const [period, setPeriod] = useState('')
  const [date, setDate] = useState(localISO())
  const [students, setStudents] = useState<Stu[]>([])
  const [current, setCurrent] = useState<Bal[]>([])
  const [arrears, setArrears] = useState<Bal[]>([])
  const [already, setAlready] = useState<{ n: number; total: number } | null>(null)
  const [entry, setEntry] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState(false)
  const [editArrears, setEditArrears] = useState(false)
  const [arrEdit, setArrEdit] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('id, name').order('name'),
      supabase.from('fee_structures').select('academic_year, term'),
      supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
    ]).then(([c, f, s]) => {
      const cls = (c.data ?? []) as { id: string; name: string }[]
      setClasses(cls)
      const keys = [...new Set((f.data ?? []).map((r) => periodKey(r.academic_year, r.term)))].sort().reverse()
      setPeriods(keys)
      const cur = s.data?.current_academic_year && s.data?.current_term ? periodKey(s.data.current_academic_year, s.data.current_term) : ''
      setPeriod(keys.includes(cur) ? cur : (keys[0] ?? ''))
    })
  }, [])

  const load = useCallback(async () => {
    if (!classId || !period) return
    setLoading(true)
    setError('')
    const [year, term] = period.split('|')
    const { data: studs, error: e1 } = await supabase.from('students').select('id, full_name').eq('class_id', classId).eq('is_active', true).order('full_name')
    if (e1) {
      setError(e1.message)
      setLoading(false)
      return
    }
    const list = (studs ?? []) as Stu[]
    const ids = list.map((s) => s.id)
    if (!ids.length) {
      setStudents([])
      setCurrent([])
      setArrears([])
      setAlready(null)
      setLoading(false)
      return
    }
    const [cur, prev, paid] = await Promise.all([
      supabase.from('student_fee_balances').select(COLS).in('student_id', ids).eq('academic_year', year).eq('term', term),
      supabase
        .from('student_fee_balances')
        .select(COLS)
        .in('student_id', ids)
        .gt('balance', 0)
        .or(`academic_year.lt."${year}",and(academic_year.eq."${year}",term.lt."${term}")`),
      supabase.from('fee_payments').select('amount').in('student_id', ids).eq('source', 'before_system').eq('status', 'valid'),
    ])
    if (cur.error || prev.error) setError((cur.error ?? prev.error)!.message)
    setStudents(list)
    setCurrent((cur.data ?? []) as Bal[])
    setArrears((prev.data ?? []) as Bal[])
    setAlready({ n: paid.data?.length ?? 0, total: (paid.data ?? []).reduce((s, r) => s + Number(r.amount), 0) })
    setLoading(false)
  }, [classId, period])

  useEffect(() => {
    setEntry({})
    setArrEdit({})
    setDone('')
    void load()
  }, [load])

  const items = useMemo(
    () => [...new Set(current.map((b) => b.item))].sort((a, b) => itemRank(a) - itemRank(b) || a.localeCompare(b)),
    [current],
  )

  // what each student still owes, per column
  const owed = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    const add = (sid: string, col: string, n: number) => {
      if (!m.has(sid)) m.set(sid, new Map())
      m.get(sid)!.set(col, (m.get(sid)!.get(col) ?? 0) + n)
    }
    for (const b of arrears) add(b.student_id, ARREARS, Number(b.balance))
    for (const b of current) add(b.student_id, b.item, Number(b.balance))
    return m
  }, [current, arrears])

  const cellAmt = (sid: string, col: string) => Number(entry[sid]?.[col] ?? '') || 0
  const cellBad = (sid: string, col: string) => cellAmt(sid, col) > (owed.get(sid)?.get(col) ?? 0) + 0.001
  const setCell = (sid: string, col: string, v: string) => {
    setDone('')
    setEntry((e) => ({ ...e, [sid]: { ...e[sid], [col]: v.replace(/[^\d.]/g, '') } }))
  }

  const arrOwed = (sid: string) => owed.get(sid)?.get(ARREARS) ?? 0
  const arrVal = (sid: string) => (arrEdit[sid] !== undefined ? Number(arrEdit[sid]) || 0 : arrOwed(sid))
  const arrChanged = students.filter((st) => arrEdit[st.id] !== undefined && Math.abs(arrVal(st.id) - arrOwed(st.id)) > 0.001)
  // the part of arrears that can be changed here is the "Opening balance" entry; other old fees stay as they are
  const fixedArr = (sid: string) => arrears.filter((b) => b.student_id === sid && b.item !== OPENING).reduce((s, b) => s + Number(b.balance), 0)
  const arrBad = (sid: string) => arrVal(sid) < fixedArr(sid) - 0.001

  async function saveArrears() {
    if (!arrChanged.length || arrChanged.some((st) => arrBad(st.id))) return
    if (!navigator.onLine) return setError('You need internet to save arrears.')
    const [y, t] = period.split('|')
    const from = prevPeriod(y, t)
    if (!confirm(`Update arrears for ${arrChanged.length} student(s) in ${className}?`)) return
    setSaving(true)
    setError('')
    for (const st of arrChanged) {
      const rowsOf = arrears.filter((b) => b.student_id === st.id && b.item === OPENING)
      const ob = rowsOf.find((b) => b.academic_year === from.year && b.term === from.term) ?? rowsOf[0]
      const paid = ob ? Number(ob.amount_due) - Number(ob.balance) : 0
      const newAmount = paid + (arrVal(st.id) - fixedArr(st.id))
      let err
      if (ob && newAmount <= 0.001 && paid === 0) err = (await supabase.from('fee_structures').delete().eq('id', ob.fee_structure_id)).error
      else if (ob) err = (await supabase.from('fee_structures').update({ amount: newAmount }).eq('id', ob.fee_structure_id)).error
      else if (newAmount > 0)
        err = (await supabase.from('fee_structures').upsert({ student_id: st.id, academic_year: from.year, term: from.term, item: OPENING, amount: newAmount }, { onConflict: 'student_id,academic_year,term,item' })).error
      if (err) {
        setSaving(false)
        setError(`Stopped at ${st.full_name}: ${err.message}`)
        void load()
        return
      }
    }
    setSaving(false)
    setArrEdit({})
    setDone(`Arrears updated for ${arrChanged.length} student(s) in ${className}.`)
    void load()
  }

  const cols = [ARREARS, ...items]
  const colTotal = (col: string) => students.reduce((s, st) => s + cellAmt(st.id, col), 0)
  const grand = cols.reduce((s, c) => s + colTotal(c), 0)
  const problems = students.reduce((n, st) => n + cols.filter((c) => cellBad(st.id, c)).length, 0)
  const filled = students.reduce((n, st) => n + cols.filter((c) => cellAmt(st.id, c) > 0).length, 0)
  const className = classes.find((c) => c.id === classId)?.name ?? ''
  const [year, term] = period.split('|')

  async function save() {
    if (!profile || !filled || problems) return
    if (!navigator.onLine) return setError('You need internet to save these payments.')
    const paidAt = date === localISO() ? new Date().toISOString() : `${date}T12:00:00.000Z`
    const rows: Record<string, unknown>[] = []
    const make = (sid: string, fsId: string, amount: number) =>
      rows.push({
        student_id: sid,
        fee_structure_id: fsId,
        amount,
        method: 'cash',
        note: 'Paid before the system',
        paid_at: paidAt,
        received_by: profile.id,
        status: 'valid',
        source: 'before_system',
      })
    for (const st of students) {
      // arrears are cleared oldest term first
      let left = cellAmt(st.id, ARREARS)
      const old = arrears
        .filter((b) => b.student_id === st.id)
        .sort((a, b) => periodKey(a.academic_year, a.term).localeCompare(periodKey(b.academic_year, b.term)) || a.item.localeCompare(b.item))
      for (const b of old) {
        if (left <= 0) break
        const take = Math.min(left, Number(b.balance))
        make(st.id, b.fee_structure_id, take)
        left -= take
      }
      for (const it of items) {
        const amt = cellAmt(st.id, it)
        const b = current.find((x) => x.student_id === st.id && x.item === it)
        if (amt > 0 && b) make(st.id, b.fee_structure_id, amt)
      }
    }
    const total = rows.reduce((s, r) => s + Number(r.amount), 0)
    if (!confirm(`Save earlier payments for ${filled} entries in ${className} totalling ${money(total)}?`)) return
    setSaving(true)
    setError('')
    // one request, so either all of the class is saved or none of it
    const { error: err } = await supabase.from('fee_payments').insert(rows)
    setSaving(false)
    if (err) return setError(`Nothing was saved: ${err.message}`)
    setDone(`${className}: ${money(total)} saved as earlier payments (${filled} entries). They show on the Receipts page marked "Before system".`)
    setEntry({})
    void load()
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Earlier payments</h1>
      <p className="mt-1 text-sm text-gray-500">
        Copy the bursar's list for one class here: what each parent paid <b>before we started using the system</b>. These are marked <b>"Before system"</b>, are not counted in today's collection, no SMS is sent, and no official receipt is printed.
      </p>

      <div className="mt-5 grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="text-sm font-medium text-royal-900">
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={`${box} mt-1 w-full`}>
            <option value="">- choose a class -</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-royal-900">
          Term the list is for
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${box} mt-1 w-full`}>
            {periods.map((p) => (
              <option key={p} value={p}>{p.split('|')[1]}, {p.split('|')[0]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-royal-900">
          Date to record
          <input type="date" value={date} max={localISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${box} mt-1 w-full`} />
        </label>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {done && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {done}
        </p>
      )}
      {already && already.n > 0 && classId && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Already entered for this class: <b>{already.n}</b> earlier payments, {money(already.total)}. The grey figures below are what is still owed, so do not type those payments again.
        </p>
      )}

      {classId && loading && (
        <p className="mt-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading {className}…</p>
      )}
      {classId && !loading && students.length === 0 && <p className="mt-6 text-sm text-gray-500">No students in this class.</p>}
      {classId && !loading && students.length > 0 && items.length === 0 && (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">No fees are set for {className} in {term}, {year}. Set them on the Fees page first.</p>
      )}

      {classId && !loading && students.length > 0 && items.length > 0 && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => { setEditArrears((v) => !v); setArrEdit({}) }}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold ${editArrears ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300 bg-white text-royal-900'}`}
            >
              {editArrears ? 'Done editing arrears' : 'Edit arrears'}
            </button>
            {editArrears && (
              <>
                <p className="text-xs text-amber-800">Type the total each student owed from before. This changes what is owed, not a payment.</p>
                <button
                  onClick={saveArrears}
                  disabled={saving || !arrChanged.length || arrChanged.some((st) => arrBad(st.id))}
                  className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-bold text-white hover:bg-royal-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : `Save arrears (${arrChanged.length})`}
                </button>
              </>
            )}
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="border-b border-gray-300 py-2 text-center text-sm font-bold uppercase tracking-wide text-royal-900">{className}</caption>
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th rowSpan={2} className="border border-royal-700 px-3 py-2 text-left font-semibold">Full Name</th>
                  <th rowSpan={2} className="w-28 border border-royal-700 px-3 py-2 text-center font-semibold">Arrears</th>
                  <th colSpan={items.length} className="border border-royal-700 px-3 py-1.5 text-center font-semibold uppercase tracking-wide">Current</th>
                </tr>
                <tr>
                  {items.map((it) => (
                    <th key={it} className="w-28 border border-royal-700 px-3 py-1.5 text-center text-xs font-semibold">{it}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((st) => (
                  <tr key={st.id} className="odd:bg-white even:bg-gray-50/60">
                    <td className="border border-gray-300 px-3 py-1 font-medium uppercase text-royal-900">{st.full_name}</td>
                    {cols.map((col) => {
                      const left = owed.get(st.id)?.get(col) ?? 0
                      const bad = cellBad(st.id, col)
                      if (col === ARREARS && editArrears) {
                        const badA = arrBad(st.id)
                        return (
                          <td key={col} className="border border-gray-300 p-0">
                            <input
                              inputMode="decimal"
                              value={arrEdit[st.id] ?? (left ? String(left) : '')}
                              disabled={saving}
                              onChange={(e) => setArrEdit((a) => ({ ...a, [st.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                              placeholder="0"
                              title={badA ? `At least ${money(fixedArr(st.id))} is owed from other old fees` : 'Total arrears owed'}
                              className={`h-9 w-full bg-amber-50 px-3 text-center outline-none focus:bg-royal-50 ${badA ? 'bg-red-50 text-red-700' : 'text-royal-900'}`}
                            />
                          </td>
                        )
                      }
                      return (
                        <td key={col} className="border border-gray-300 p-0">
                          {left > 0 ? (
                            <input
                              inputMode="decimal"
                              value={entry[st.id]?.[col] ?? ''}
                              disabled={saving}
                              onChange={(e) => setCell(st.id, col, e.target.value)}
                              placeholder={left.toFixed(0)}
                              title={bad ? `Only ${money(left)} is owed` : `Owed: ${money(left)}`}
                              className={`h-9 w-full bg-transparent px-3 text-center outline-none placeholder:text-gray-300 focus:bg-royal-50 ${bad ? 'bg-red-50 text-red-700' : 'text-royal-900'}`}
                            />
                          ) : (
                            <span className="block px-3 text-center text-gray-300">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-royal-50 font-semibold text-royal-900">
                  <td className="border border-gray-300 px-3 py-2">Total entered</td>
                  {cols.map((c) => (
                    <td key={c} className="border border-gray-300 px-3 py-2 text-center">{colTotal(c) ? colTotal(c).toFixed(2) : '—'}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Type only what was paid. A dash means nothing is owed there. Grey figures show the amount still owed.
              {problems > 0 && <b className="ml-1 text-red-600">{problems} amount(s) are more than what is owed.</b>}
            </p>
            <button
              onClick={save}
              disabled={saving || !filled || problems > 0}
              className="flex items-center gap-2 rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-bold text-royal-900 hover:bg-gold-500 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : filled ? `Save ${money(grand)}` : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}