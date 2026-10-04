import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, Loader2, Users, Wallet, Banknote, AlertCircle, Lock, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

/* ---------- types & helpers ---------- */

interface BalanceRow {
  student_id: string
  full_name: string
  admission_number: string
  term_due: number
  term_paid: number
  term_balance: number
  arrears: number
  total_owing: number
}

const TERMS = ['Term 1', 'Term 2', 'Term 3']

function defaultYear() {
  const d = new Date()
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}/${start + 1}`
}

function yearOptions(extra: string) {
  const start = Number(defaultYear().slice(0, 4))
  const base = [start - 1, start, start + 1].map((n) => `${n}/${n + 1}`)
  return base.includes(extra) ? base : [...base, extra].sort()
}

const money = (n: number) =>
  'GH₵ ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/* ---------- page ---------- */

export default function TeacherFees() {
  const { profile } = useAuth()

  const [myClass, setMyClass] = useState<{ id: string; name: string } | null>(null)
  const [classLoaded, setClassLoaded] = useState(false)

  const [year, setYear] = useState(defaultYear())
  const [term, setTerm] = useState(TERMS[0])

  const [rows, setRows] = useState<BalanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [showPaid, setShowPaid] = useState(false)

  /* ----- the teacher's class and the current term ----- */
  useEffect(() => {
    async function init() {
      if (!profile) return
      const [classRes, settings] = await Promise.all([
        supabase.from('classes').select('id, name').eq('teacher_id', profile.id).maybeSingle(),
        supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
      ])
      setMyClass(classRes.data ? { id: classRes.data.id, name: classRes.data.name } : null)
      if (settings.data?.current_academic_year) setYear(settings.data.current_academic_year)
      if (settings.data?.current_term) setTerm(settings.data.current_term)
      setClassLoaded(true)
    }
    void init()
  }, [profile])

  /* ----- balances for the chosen term ----- */
  const load = useCallback(async () => {
    if (!myClass) return
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('class_fee_balances', {
      p_class_id: myClass.id,
      p_year: year,
      p_term: term,
    })
    if (rpcError) {
      setError(rpcError.message)
      setRows([])
    } else {
      setRows(
        ((data ?? []) as BalanceRow[]).map((r) => ({
          ...r,
          term_due: Number(r.term_due),
          term_paid: Number(r.term_paid),
          term_balance: Number(r.term_balance),
          arrears: Number(r.arrears),
          total_owing: Number(r.total_owing),
        })),
      )
    }
    setLoading(false)
  }, [myClass, year, term])

  useEffect(() => {
    void load()
  }, [load])

  /* ----- derived ----- */
  const owing = useMemo(() => rows.filter((r) => r.total_owing > 0), [rows])
  const totalOwing = owing.reduce((s, r) => s + r.total_owing, 0)
  const totalDue = rows.reduce((s, r) => s + r.term_due, 0)
  const totalPaid = rows.reduce((s, r) => s + r.term_paid, 0)
  const noFeesSet = rows.length > 0 && totalDue === 0 && owing.length === 0

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (showPaid ? rows : owing)
      .filter((r) => !q || r.full_name.toLowerCase().includes(q) || r.admission_number.toLowerCase().includes(q))
      .sort((a, b) => b.total_owing - a.total_owing || a.full_name.localeCompare(b.full_name))
  }, [rows, owing, showPaid, search])

  /* ---------- render ---------- */
  if (classLoaded && !myClass) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link to="/teacher" className="inline-flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="mt-4 rounded-2xl bg-white p-6 text-sm text-gray-600 shadow-sm">
          Fees are shown to class teachers only. You haven&apos;t been assigned a class yet.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/teacher" className="inline-flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-royal-900">Fees{myClass ? ` · ${myClass.name}` : ''}</h1>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Only you and the school office can see this list. Please don&apos;t read it out or display it in class.
      </p>

      {/* Term selector */}
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-500">Academic year</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={`${inputClass} mt-1 w-36`}>
            {yearOptions(year).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Term</label>
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={`${inputClass} mt-1 w-32`}>
            {TERMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="col-span-2 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Total owing</p>
            <p className="text-2xl font-bold text-red-600">{loading ? '…' : money(totalOwing)}</p>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-royal-600/10 text-royal-700">
            <Users className="h-4 w-4" />
          </div>
          <p className="mt-2 text-xl font-bold text-royal-900">{loading ? '…' : owing.length}</p>
          <p className="text-xs text-gray-500">Students owing</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-400/20 text-gold-500">
            <Banknote className="h-4 w-4" />
          </div>
          <p className="mt-2 text-xl font-bold text-royal-900">
            {loading ? '…' : `${totalDue > 0 ? Math.min(100, Math.round((totalPaid / totalDue) * 100)) : 0}%`}
          </p>
          <p className="text-xs text-gray-500">Paid this term</p>
        </div>
      </div>

      {/* Search + toggle */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or admission number"
            className={`${inputClass} pl-9`}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showPaid}
            onChange={(e) => setShowPaid(e.target.checked)}
            className="h-4 w-4 accent-royal-600"
          />
          Show everyone
        </label>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {/* List */}
      <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="py-12 text-center text-gray-400">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : noFeesSet ? (
          <p className="p-6 text-center text-sm text-gray-500">
            No fees have been set for your class for {term}, {year} yet.
          </p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-gray-500">
            {owing.length === 0 ? (
              <>
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p>Nobody in your class owes fees for {term}, {year}.</p>
              </>
            ) : (
              <p>No students match your search.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((r) => {
              const owes = r.total_owing > 0
              return (
                <li key={r.student_id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-royal-900">{r.full_name}</p>
                    <p className="text-xs text-gray-500">{r.admission_number}</p>
                    {owes && (
                      <p className="mt-1 text-xs text-gray-500">
                        This term {money(r.term_balance)}
                        {r.arrears > 0 && <span className="text-amber-700"> · Arrears {money(r.arrears)}</span>}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {owes ? (
                      <p className="text-sm font-bold text-red-600">{money(r.total_owing)}</p>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        Cleared
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}