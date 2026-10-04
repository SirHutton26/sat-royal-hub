import { useEffect, useMemo, useState } from 'react'
import { Loader2, Download, Wallet, Banknote, AlertCircle, Percent } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { METHOD_LABEL, admissionNo, money, studentName, type Method } from '@/components/fees/fee-utils'

/* ---------- types ---------- */

interface StudentRow {
  id: string
  classes: { name: string } | null
  [key: string]: unknown
}

interface BalanceRow {
  student_id: string
  item: string
  amount_due: number
  amount_paid: number
  balance: number
}

interface PaymentRow {
  amount: number
  method: Method
  paid_at: string
}

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const periodKey = (year: string, term: string) => `${year}|${term}`
const periodLabel = (key: string) => {
  const [year, term] = key.split('|')
  return `${term} · ${year}`
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const text = rows.map((r) => r.map(esc).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0)

function Bar({ value, color = 'bg-gold-400' }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

/* ---------- page ---------- */

export default function BursarReports() {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [period, setPeriod] = useState('')
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ----- students, terms and the current term ----- */
  useEffect(() => {
    async function init() {
      const [studs, fees, settings] = await Promise.all([
        supabase.from('students').select('*, classes(name)'),
        supabase.from('fee_structures').select('academic_year, term'),
        supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
      ])
      if (studs.error || fees.error) setError(studs.error?.message ?? fees.error?.message ?? 'Could not load data')
      setStudents((studs.data ?? []) as unknown as StudentRow[])

      const keys = [...new Set((fees.data ?? []).map((f) => periodKey(f.academic_year, f.term)))].sort()
      setPeriods(keys)
      const s = settings.data
      const currentKey = s?.current_academic_year && s?.current_term ? periodKey(s.current_academic_year, s.current_term) : ''
      setPeriod(keys.includes(currentKey) ? currentKey : (keys[keys.length - 1] ?? ''))
      if (keys.length === 0) setLoading(false)
    }
    void init()
  }, [])

  /* ----- figures for the chosen term ----- */
  useEffect(() => {
    if (!period) return
    async function load() {
      setLoading(true)
      const [year, term] = period.split('|')
      const [bal, pay] = await Promise.all([
        supabase
          .from('student_fee_balances')
          .select('student_id, item, amount_due, amount_paid, balance')
          .eq('academic_year', year)
          .eq('term', term),
        supabase
          .from('fee_payments')
          .select('amount, method, paid_at, fee_structures!inner(academic_year, term)')
          .eq('status', 'valid')
          .eq('fee_structures.academic_year', year)
          .eq('fee_structures.term', term),
      ])
      if (bal.error || pay.error) setError(bal.error?.message ?? pay.error?.message ?? 'Could not load figures')
      setBalances(
        ((bal.data ?? []) as BalanceRow[]).map((r) => ({
          ...r,
          amount_due: Number(r.amount_due),
          amount_paid: Number(r.amount_paid),
          balance: Number(r.balance),
        })),
      )
      setPayments(((pay.data ?? []) as unknown as PaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) })))
      setLoading(false)
    }
    void load()
  }, [period])

  /* ----- derived ----- */
  const report = useMemo(() => {
    const billed = balances.reduce((s, b) => s + b.amount_due, 0)
    const collected = payments.reduce((s, p) => s + p.amount, 0)
    const outstanding = balances.reduce((s, b) => s + Math.max(b.balance, 0), 0)

    const studentById = new Map(students.map((s) => [s.id, s]))

    // per student, then rolled up by class
    const perStudent = new Map<string, { due: number; paid: number; balance: number }>()
    for (const b of balances) {
      const cur = perStudent.get(b.student_id) ?? { due: 0, paid: 0, balance: 0 }
      cur.due += b.amount_due
      cur.paid += b.amount_paid
      cur.balance += Math.max(b.balance, 0)
      perStudent.set(b.student_id, cur)
    }

    const classMap = new Map<string, { students: number; owing: number; due: number; paid: number; balance: number }>()
    for (const [id, v] of perStudent) {
      const name = studentById.get(id)?.classes?.name ?? 'Unassigned'
      const cur = classMap.get(name) ?? { students: 0, owing: 0, due: 0, paid: 0, balance: 0 }
      cur.students += 1
      cur.owing += v.balance > 0 ? 1 : 0
      cur.due += v.due
      cur.paid += v.paid
      cur.balance += v.balance
      classMap.set(name, cur)
    }
    const byClass = [...classMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name))

    const itemMap = new Map<string, { due: number; paid: number }>()
    for (const b of balances) {
      const cur = itemMap.get(b.item) ?? { due: 0, paid: 0 }
      cur.due += b.amount_due
      cur.paid += b.amount_paid
      itemMap.set(b.item, cur)
    }
    const byItem = [...itemMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.due - a.due)

    const byMethod: Record<Method, number> = { cash: 0, mobile_money: 0, bank: 0 }
    for (const p of payments) byMethod[p.method] += p.amount

    // last 7 days, including days with nothing collected
    const days: { key: string; label: string; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push({
        key: d.toLocaleDateString('en-CA'),
        label: d.toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' }),
        total: 0,
      })
    }
    for (const p of payments) {
      const day = days.find((d) => d.key === new Date(p.paid_at).toLocaleDateString('en-CA'))
      if (day) day.total += p.amount
    }

    const owingStudents = [...perStudent.entries()]
      .filter(([, v]) => v.balance > 0)
      .map(([id, v]) => ({ student: studentById.get(id), ...v }))
      .sort((a, b) => b.balance - a.balance)

    return { billed, collected, outstanding, rate: pct(collected, billed), byClass, byItem, byMethod, days, owingStudents }
  }, [balances, payments, students])

  const methodTotal = report.byMethod.cash + report.byMethod.mobile_money + report.byMethod.bank
  const maxDay = Math.max(...report.days.map((d) => d.total), 1)

  function exportClassSummary() {
    downloadCsv(`class-summary-${period.replace('|', '-').replace(/\s+/g, '')}.csv`, [
      ['Class', 'Students', 'Students owing', 'Billed', 'Paid', 'Outstanding', 'Collection rate %'],
      ...report.byClass.map((c) => [c.name, c.students, c.owing, c.due, c.paid, c.balance, pct(c.paid, c.due)]),
    ])
  }

  function exportOwing() {
    downloadCsv(`students-owing-${period.replace('|', '-').replace(/\s+/g, '')}.csv`, [
      ['Student', 'Admission no', 'Class', 'Billed', 'Paid', 'Balance'],
      ...report.owingStudents.map((o) => [
        o.student ? studentName(o.student) : 'Unknown',
        o.student ? admissionNo(o.student) : '',
        o.student?.classes?.name ?? '',
        o.due,
        o.paid,
        o.balance,
      ]),
    ])
  }

  const summary = [
    { label: 'Total billed', value: money(report.billed), icon: Wallet, chip: 'bg-royal-600/10 text-royal-700', tone: 'text-royal-900' },
    { label: 'Collected', value: money(report.collected), icon: Banknote, chip: 'bg-gold-400/20 text-gold-500', tone: 'text-royal-900' },
    { label: 'Outstanding', value: money(report.outstanding), icon: AlertCircle, chip: 'bg-red-50 text-red-600', tone: 'text-red-600' },
    { label: 'Collection rate', value: `${report.rate}%`, icon: Percent, chip: 'bg-emerald-50 text-emerald-700', tone: 'text-royal-900' },
  ]

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">How fees are being collected, by class, item and payment method.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {periods.length > 0 && (
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
              {periods.map((k) => (
                <option key={k} value={k}>
                  {periodLabel(k)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={exportClassSummary}
            disabled={loading || report.byClass.length === 0}
            className="flex items-center gap-2 rounded-lg bg-royal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-royal-600 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Class summary
          </button>
          <button
            onClick={exportOwing}
            disabled={loading || report.owingStudents.length === 0}
            className="flex items-center gap-2 rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-royal-900 transition hover:bg-gold-500 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Students owing
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {periods.length === 0 && !loading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-royal-900">No fees have been set up yet</p>
          <p className="mt-1 text-sm text-gray-500">Reports will appear once the admin adds fees for a term.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map(({ label, value, icon: Icon, chip, tone }) => (
              <div key={label} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className={`mt-4 truncate text-2xl font-bold ${tone}`}>
                  {loading ? <Loader2 className="h-6 w-6 animate-spin text-gray-300" /> : value}
                </p>
                <p className="text-sm text-gray-500">{label}</p>
              </div>
            ))}
          </div>

          {/* By class */}
          <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
            <p className="px-5 pt-5 text-sm font-semibold text-royal-900">Collection by class</p>
            {report.byClass.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-gray-500">No billing data for this term.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Class</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Students</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Owing</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Paid</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Outstanding</th>
                      <th className="w-40 px-5 py-2.5 font-semibold">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.byClass.map((c) => {
                      const rate = pct(c.paid, c.due)
                      return (
                        <tr key={c.name}>
                          <td className="px-5 py-3 font-semibold text-royal-900">{c.name}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{c.students}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{c.owing}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{money(c.due)}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{money(c.paid)}</td>
                          <td className={`px-3 py-3 text-right font-bold ${c.balance > 0 ? 'text-red-600' : 'text-royal-900'}`}>
                            {money(c.balance)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <Bar value={rate} />
                              </div>
                              <span className="w-9 text-right text-xs font-semibold text-gray-500">{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {/* By method */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-royal-900">By payment method</p>
              <div className="mt-4 space-y-4">
                {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                  <div key={m}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-600">{METHOD_LABEL[m]}</span>
                      <span className="font-semibold text-royal-900">{money(report.byMethod[m])}</span>
                    </div>
                    <Bar value={pct(report.byMethod[m], methodTotal)} color="bg-royal-600" />
                  </div>
                ))}
              </div>
            </div>

            {/* By item */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-royal-900">By fee item</p>
              {report.byItem.length === 0 ? (
                <p className="mt-6 text-center text-sm text-gray-500">No fee items for this term.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {report.byItem.map((i) => (
                    <div key={i.name}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="text-gray-600">{i.name}</span>
                        <span className="text-xs text-gray-500">
                          <b className="text-sm text-royal-900">{money(i.paid)}</b> of {money(i.due)}
                        </span>
                      </div>
                      <Bar value={pct(i.paid, i.due)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Last 7 days */}
          <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-royal-900">Last 7 days</p>
            <div className="mt-4 space-y-3">
              {report.days.map((d) => (
                <div key={d.key} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-gray-500">{d.label}</span>
                  <div className="flex-1">
                    <Bar value={pct(d.total, maxDay)} />
                  </div>
                  <span className="w-28 shrink-0 text-right font-semibold text-royal-900">{money(d.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
