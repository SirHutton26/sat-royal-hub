import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Loader2, X, HandCoins } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { admissionNo, money, studentName } from '@/components/fees/fee-utils'

/* ---------- types ---------- */

interface StudentRow {
  id: string
  class_id: string | null
  classes: { name: string } | null
  [key: string]: unknown
}

interface BalanceRow {
  student_id: string
  fee_structure_id: string
  academic_year: string
  term: string
  item: string
  amount_due: number
  amount_paid: number
  balance: number
}

type Status = 'paid' | 'partial' | 'owing' | 'none'

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  partial: { label: 'Partial', cls: 'bg-gold-400/25 text-royal-900' },
  owing: { label: 'Owing', cls: 'bg-red-50 text-red-600' },
  none: { label: 'No fees set', cls: 'bg-gray-100 text-gray-500' },
}

const TABS: { value: 'all' | Status; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owing', label: 'Owing' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
]

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const periodKey = (year: string, term: string) => `${year}|${term}`
const periodLabel = (key: string) => {
  const [year, term] = key.split('|')
  return `${term} · ${year}`
}

function StatusChip({ status }: { status: Status }) {
  const m = STATUS_META[status]
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

function statusOf(items: BalanceRow[], arrears: number): Status {
  if (items.length === 0 && arrears <= 0) return 'none'
  const balance = items.reduce((s, i) => s + Math.max(i.balance, 0), 0) + arrears
  const paid = items.reduce((s, i) => s + i.amount_paid, 0)
  if (balance <= 0) return 'paid'
  return paid > 0 ? 'partial' : 'owing'
}

/* ---------- page ---------- */

export default function BursarStudents() {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [period, setPeriod] = useState('')
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [arrears, setArrears] = useState<BalanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [tab, setTab] = useState<'all' | Status>('all')
  const [selected, setSelected] = useState<StudentRow | null>(null)

  /* ----- students, available terms and the current term ----- */
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
      setLoading(false)
    }
    void init()
  }, [])

  /* ----- balances for the chosen term ----- */
  useEffect(() => {
    if (!period) return
    async function loadBalances() {
      setLoadingBalances(true)
      const [year, term] = period.split('|')
      const cols = 'student_id, fee_structure_id, academic_year, term, item, amount_due, amount_paid, balance'
      const [cur, prev] = await Promise.all([
        supabase.from('student_fee_balances').select(cols).eq('academic_year', year).eq('term', term),
        // unpaid items from any earlier term are the student's arrears
        supabase
          .from('student_fee_balances')
          .select(cols)
          .gt('balance', 0)
          .or(`academic_year.lt."${year}",and(academic_year.eq."${year}",term.lt."${term}")`),
      ])
      if (cur.error || prev.error) setError(cur.error?.message ?? prev.error?.message ?? 'Could not load balances')
      const toRows = (data: unknown) =>
        ((data ?? []) as BalanceRow[]).map((r) => ({
          ...r,
          amount_due: Number(r.amount_due),
          amount_paid: Number(r.amount_paid),
          balance: Number(r.balance),
        }))
      setBalances(toRows(cur.data))
      setArrears(toRows(prev.data))
      setLoadingBalances(false)
    }
    void loadBalances()
  }, [period])

  /* ----- derived ----- */
  const rows = useMemo(() => {
    const byStudent = new Map<string, BalanceRow[]>()
    for (const b of balances) byStudent.set(b.student_id, [...(byStudent.get(b.student_id) ?? []), b])
    const arrearsBy = new Map<string, BalanceRow[]>()
    for (const a of arrears) arrearsBy.set(a.student_id, [...(arrearsBy.get(a.student_id) ?? []), a])

    return students
      .map((s) => {
        const items = byStudent.get(s.id) ?? []
        const arrearsItems = (arrearsBy.get(s.id) ?? []).sort(
          (a, b) =>
            periodKey(a.academic_year, a.term).localeCompare(periodKey(b.academic_year, b.term)) ||
            a.item.localeCompare(b.item),
        )
        const arrearsTotal = arrearsItems.reduce((t, i) => t + i.balance, 0)
        const termBalance = items.reduce((t, i) => t + Math.max(i.balance, 0), 0)
        return {
          student: s,
          items,
          arrearsItems,
          arrearsTotal,
          name: studentName(s),
          adm: admissionNo(s),
          className: s.classes?.name ?? '—',
          due: items.reduce((t, i) => t + i.amount_due, 0),
          paid: items.reduce((t, i) => t + i.amount_paid, 0),
          termBalance,
          balance: termBalance + arrearsTotal, // everything this student owes, arrears included
          status: statusOf(items, arrearsTotal),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [students, balances, arrears])

  const classOptions = useMemo(
    () => [...new Set(students.map((s) => s.classes?.name).filter(Boolean) as string[])].sort(),
    [students],
  )

  // Counts on the tabs respect the search and class filters, but not the tab itself
  const base = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => classFilter === 'all' || r.className === classFilter)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.adm.toLowerCase().includes(q))
  }, [rows, query, classFilter])

  const counts = useMemo(() => {
    const c: Record<'all' | Status, number> = { all: base.length, owing: 0, partial: 0, paid: 0, none: 0 }
    for (const r of base) c[r.status] += 1
    return c
  }, [base])

  const visible = useMemo(() => (tab === 'all' ? base : base.filter((r) => r.status === tab)), [base, tab])
  const visibleBalance = visible.reduce((t, r) => t + r.balance, 0)

  const selectedRow = selected ? rows.find((r) => r.student.id === selected.id) : null

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Students</h1>
          <p className="mt-1 text-sm text-gray-500">See who has paid, who owes and how much, term by term.</p>
        </div>
        {periods.length > 0 && (
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${inputClass} !w-auto`}>
            {periods.map((k) => (
              <option key={k} value={k}>
                {periodLabel(k)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* Filters */}
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search student name or admission number"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={inputClass}>
          <option value="all">All classes</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.value ? 'bg-royal-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label} <span className="opacity-70">({counts[t.value]})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        {loading || loadingBalances ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">No students match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-royal-700 text-left text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 text-right font-semibold">Billed</th>
                  <th className="px-4 py-3 text-right font-semibold">Paid</th>
                  <th className="px-4 py-3 text-right font-semibold">Arrears</th>
                  <th className="px-4 py-3 text-right font-semibold">Total owing</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((r) => (
                  <tr
                    key={r.student.id}
                    onClick={() => setSelected(r.student)}
                    className="cursor-pointer transition hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-royal-900">{r.name}</p>
                      {r.adm && <p className="text-xs text-gray-500">{r.adm}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.className}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.items.length ? money(r.due) : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.items.length ? money(r.paid) : '—'}</td>
                    <td className={`px-4 py-3 text-right ${r.arrearsTotal > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>
                      {r.arrearsTotal > 0 ? money(r.arrearsTotal) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${r.balance > 0 ? 'text-red-600' : 'text-royal-900'}`}>
                      {r.items.length || r.arrearsTotal > 0 ? money(r.balance) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Outstanding in this list
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{money(visibleBalance)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-royal-900">{selectedRow.name}</h2>
                <p className="text-sm text-gray-500">
                  {[selectedRow.adm, selectedRow.className].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 text-xs font-semibold text-gold-500">{period && periodLabel(period)}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedRow.items.length === 0 ? (
              <p className="mt-6 rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
                No fees have been set for this student's class in this term.
              </p>
            ) : (
              <div className="mt-5 space-y-2">
                {selectedRow.items.map((i) => {
                  const st: Status = i.balance <= 0 ? 'paid' : i.amount_paid > 0 ? 'partial' : 'owing'
                  return (
                    <div key={i.fee_structure_id} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-royal-900">{i.item}</p>
                        <StatusChip status={st} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 text-xs text-gray-500">
                        <span>Billed <b className="block text-sm text-royal-900">{money(i.amount_due)}</b></span>
                        <span>Paid <b className="block text-sm text-royal-900">{money(i.amount_paid)}</b></span>
                        <span>
                          Balance{' '}
                          <b className={`block text-sm ${i.balance > 0 ? 'text-red-600' : 'text-royal-900'}`}>
                            {money(Math.max(i.balance, 0))}
                          </b>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {selectedRow.arrearsItems.length > 0 && (
              <div className="mt-3 rounded-xl bg-amber-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-900">Arrears from previous terms</p>
                  <p className="text-sm font-bold text-amber-900">{money(selectedRow.arrearsTotal)}</p>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-amber-900">
                  {selectedRow.arrearsItems.map((a) => (
                    <li key={a.fee_structure_id} className="flex justify-between gap-3">
                      <span>
                        {a.item} · {a.term}, {a.academic_year}
                      </span>
                      <span className="font-semibold">{money(a.balance)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between rounded-xl bg-royal-900 px-4 py-3 text-white">
              <span className="text-sm">{selectedRow.arrearsItems.length > 0 ? 'Total owing (incl. arrears)' : 'Total balance'}</span>
              <span className="text-lg font-bold text-gold-400">{money(selectedRow.balance)}</span>
            </div>

            {selectedRow.balance > 0 && (
              <Link
                to="/bursar/record-payment"
                className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-gold-400 px-4 py-2.5 text-sm font-semibold text-royal-900 transition hover:bg-gold-500"
              >
                <HandCoins className="h-4 w-4" />
                Go to Record Payment
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}