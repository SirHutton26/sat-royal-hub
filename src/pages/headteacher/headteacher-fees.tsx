import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { money } from '@/components/fees/fee-utils'
import { fetchAll } from '@/lib/headteacher'
import { addDays, isoOf, monday } from '@/lib/store'

interface Bal {
  student_id: string
  academic_year: string
  term: string
  amount_due: number | string
  amount_paid: number | string
  balance: number | string
}
interface Pay {
  receipt_no: string
  amount: number | string
  paid_at: string
  method: string
  students: { full_name: string; classes: { name: string } | null } | null
}

const n = (v: number | string | null | undefined) => Number(v ?? 0)

/** Read-only view of what the bursar has collected */
export default function HeadteacherFees() {
  const [year, setYear] = useState('')
  const [term, setTerm] = useState('')
  const [bal, setBal] = useState<Bal[] | null>(null)
  const [stu, setStu] = useState<{ id: string; class_id: string }[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [recent, setRecent] = useState<Pay[]>([])
  const [paid, setPaid] = useState<{ amount: number | string; paid_at: string }[]>([])

  useEffect(() => {
    const weekStart = `${isoOf(addDays(monday(new Date()), 0))}T00:00:00Z`
    Promise.all([
      supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
      supabase.from('classes').select('id, name').order('name'),
      fetchAll<{ id: string; class_id: string }>((a, b) => supabase.from('students').select('id, class_id').eq('is_active', true).range(a, b)),
      fetchAll<Bal>((a, b) => supabase.from('student_fee_balances').select('student_id, academic_year, term, amount_due, amount_paid, balance').range(a, b)),
      supabase.from('fee_payments').select('receipt_no, amount, paid_at, method, students(full_name, classes(name))').eq('status', 'valid').order('paid_at', { ascending: false }).limit(10),
      supabase.from('fee_payments').select('amount, paid_at').eq('status', 'valid').gte('paid_at', weekStart),
    ]).then(([s, c, st, b, r, w]) => {
      setYear(s.data?.current_academic_year ?? '')
      setTerm(s.data?.current_term ?? '')
      setClasses((c.data ?? []) as { id: string; name: string }[])
      setStu(st)
      setBal(b)
      setRecent((r.data ?? []) as unknown as Pay[])
      setPaid((w.data ?? []) as { amount: number | string; paid_at: string }[])
    })
  }, [])

  const calc = useMemo(() => {
    if (!bal) return null
    const key = `${year}|${term}`
    const classOf = new Map(stu.map((s) => [s.id, s.class_id]))
    const byClass = new Map<string, { due: number; paid: number; out: number; arrears: number }>()
    let due = 0
    let collected = 0
    let out = 0
    let arrears = 0
    for (const r of bal) {
      const k = `${r.academic_year}|${r.term}`
      const cid = classOf.get(r.student_id)
      if (!cid) continue
      const row = byClass.get(cid) ?? { due: 0, paid: 0, out: 0, arrears: 0 }
      if (k === key) {
        row.due += n(r.amount_due)
        row.paid += n(r.amount_paid)
        row.out += Math.max(n(r.balance), 0)
        due += n(r.amount_due)
        collected += n(r.amount_paid)
        out += Math.max(n(r.balance), 0)
      } else if (k < key) {
        row.arrears += Math.max(n(r.balance), 0)
        arrears += Math.max(n(r.balance), 0)
      }
      byClass.set(cid, row)
    }
    return { byClass, due, collected, out, arrears }
  }, [bal, stu, year, term])

  const today = isoOf()
  const todayTotal = paid.filter((p) => String(p.paid_at).slice(0, 10) === today).reduce((a, p) => a + n(p.amount), 0)
  const weekTotal = paid.reduce((a, p) => a + n(p.amount), 0)

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Fees</h1>
      <p className="mt-1 text-sm text-gray-500">
        What the bursar has collected{term && year ? ` - ${term}, ${year}` : ''}. View only.
      </p>

      {!calc ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Collected today', money(todayTotal), `${money(weekTotal)} this week`],
              ['Collected this term', money(calc.collected), `of ${money(calc.due)} due`],
              ['Still owed this term', money(calc.out), calc.due ? `${Math.round((calc.collected / calc.due) * 100)}% collected` : ''],
              ['Arrears from earlier terms', money(calc.arrears), ''],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className="mt-1 text-lg font-bold text-royal-900">{v}</p>
                <p className="text-xs text-gray-400">{sub}</p>
              </div>
            ))}
          </div>

          <section className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <h2 className="px-4 pt-4 font-semibold text-royal-900">By class</h2>
            <table className="mt-2 w-full min-w-[620px] text-left text-sm">
              <thead className="text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Class</th>
                  <th className="px-2 py-2 text-right">Due</th>
                  <th className="px-2 py-2 text-right">Paid</th>
                  <th className="px-2 py-2 text-right">Owed</th>
                  <th className="px-2 py-2 text-right">Arrears</th>
                  <th className="w-40 px-4 py-2">Collected</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => {
                  const r = calc.byClass.get(c.id) ?? { due: 0, paid: 0, out: 0, arrears: 0 }
                  const p = r.due ? Math.round((r.paid / r.due) * 100) : 0
                  return (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 font-medium text-royal-900">{c.name}</td>
                      <td className="px-2 py-2.5 text-right text-gray-600">{r.due.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold text-green-600">{r.paid.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold text-red-600">{r.out.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right text-gray-600">{r.arrears.toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-royal-500" style={{ width: `${p}%` }} /></div>
                          <span className="w-9 text-right text-xs text-gray-500">{p}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <section className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <h2 className="px-4 pt-4 font-semibold text-royal-900">Latest payments</h2>
            <table className="mt-2 w-full min-w-[520px] text-left text-sm">
              <tbody>
                {recent.map((p) => (
                  <tr key={p.receipt_no} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.receipt_no}</td>
                    <td className="px-2 py-2.5">
                      <span className="font-medium text-royal-900">{p.students?.full_name ?? ''}</span>
                      <span className="ml-2 text-xs text-gray-400">{p.students?.classes?.name ?? ''}</span>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-gray-500">{new Date(p.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{money(n(p.amount))}</td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td className="px-4 py-6 text-center text-gray-500">No payments yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
