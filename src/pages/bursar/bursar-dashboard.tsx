import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet,
  Banknote,
  AlertCircle,
  CalendarDays,
  HandCoins,
  Receipt as ReceiptIcon,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { METHOD_LABEL, money, studentName, type Method } from '@/components/fees/fee-utils'

interface TermPayment {
  amount: number
  method: Method
  paid_at: string
}

interface RecentPayment {
  id: string
  receipt_no: string
  amount: number
  method: Method
  paid_at: string
  students: Record<string, unknown> | null
  fee_structures: { item: string } | null
}

interface BalanceRow {
  student_id: string
  amount_due: number
  amount_paid: number
  balance: number
}

const QUICK_ACTIONS = [
  { label: 'Record Payment', desc: 'Take a fee payment and issue a receipt', to: '/bursar/record-payment', icon: HandCoins },
  { label: 'Receipts', desc: 'Find, reprint or void a receipt', to: '/bursar/receipts', icon: ReceiptIcon },
]

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  const sameDay = d >= startOfToday()
  return sameDay
    ? d.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })
}

export default function BursarDashboard() {
  const { profile } = useAuth()
  const firstName = (profile?.full_name || profile?.username || 'Bursar').split(' ')[0]

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<{ year: string | null; term: string | null }>({ year: null, term: null })
  const [termPayments, setTermPayments] = useState<TermPayment[]>([])
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [recent, setRecent] = useState<RecentPayment[]>([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      const { data: settings, error: settingsError } = await supabase
        .from('school_settings')
        .select('current_academic_year, current_term')
        .limit(1)
        .maybeSingle()
      if (settingsError) setError(`Could not read school settings: ${settingsError.message}`)

      const year = settings?.current_academic_year ?? null
      const term = settings?.current_term ?? null
      setPeriod({ year, term })

      const recentReq = supabase
        .from('fee_payments')
        .select('id, receipt_no, amount, method, paid_at, students(*), fee_structures(item)')
        .eq('status', 'valid')
        .order('paid_at', { ascending: false })
        .limit(6)

      // Without a current term set there is nothing to total, so only load recent payments
      if (!year || !term) {
        const { data } = await recentReq
        setRecent(((data ?? []) as unknown as RecentPayment[]).map((r) => ({ ...r, amount: Number(r.amount) })))
        setTermPayments([])
        setBalances([])
        setLoading(false)
        return
      }

      const [termRes, balRes, recentRes] = await Promise.all([
        supabase
          .from('fee_payments')
          .select('amount, method, paid_at, fee_structures!inner(term, academic_year)')
          .eq('status', 'valid')
          .eq('fee_structures.academic_year', year)
          .eq('fee_structures.term', term),
        supabase
          .from('student_fee_balances')
          .select('student_id, amount_due, amount_paid, balance')
          .eq('academic_year', year)
          .eq('term', term),
        recentReq,
      ])

      if (termRes.error || balRes.error || recentRes.error) {
        setError(termRes.error?.message ?? balRes.error?.message ?? recentRes.error?.message ?? 'Could not load figures')
      }

      setTermPayments(
        ((termRes.data ?? []) as unknown as TermPayment[]).map((p) => ({ ...p, amount: Number(p.amount) })),
      )
      setBalances(
        ((balRes.data ?? []) as BalanceRow[]).map((b) => ({
          ...b,
          amount_due: Number(b.amount_due),
          amount_paid: Number(b.amount_paid),
          balance: Number(b.balance),
        })),
      )
      setRecent(((recentRes.data ?? []) as unknown as RecentPayment[]).map((r) => ({ ...r, amount: Number(r.amount) })))
      setLoading(false)
    }
    void load()
  }, [])

  const stats = useMemo(() => {
    const today = startOfToday().getTime()
    const collectedToday = termPayments.filter((p) => new Date(p.paid_at).getTime() >= today).reduce((s, p) => s + p.amount, 0)
    const collectedTerm = termPayments.reduce((s, p) => s + p.amount, 0)

    // A student is "owing" when their balance across all current-term items is above zero
    const perStudent = new Map<string, number>()
    for (const b of balances) perStudent.set(b.student_id, (perStudent.get(b.student_id) ?? 0) + b.balance)
    const studentsOwing = [...perStudent.values()].filter((v) => v > 0).length

    const totalDue = balances.reduce((s, b) => s + b.amount_due, 0)
    const totalPaid = balances.reduce((s, b) => s + b.amount_paid, 0)
    const outstanding = balances.reduce((s, b) => s + Math.max(b.balance, 0), 0)
    const rate = totalDue > 0 ? Math.min(100, Math.round((totalPaid / totalDue) * 100)) : 0

    const byMethod: Record<Method, number> = { cash: 0, mobile_money: 0, bank: 0 }
    for (const p of termPayments) byMethod[p.method] += p.amount

    return { collectedToday, collectedTerm, studentsOwing, totalDue, outstanding, rate, byMethod }
  }, [termPayments, balances])

  const cards = [
    { label: 'Collected today', value: money(stats.collectedToday), icon: Wallet, chip: 'bg-gold-400/20 text-gold-500', tone: 'text-royal-900' },
    { label: 'Collected this term', value: money(stats.collectedTerm), icon: CalendarDays, chip: 'bg-gold-400/20 text-gold-500', tone: 'text-royal-900' },
    { label: 'Students owing', value: String(stats.studentsOwing), icon: AlertCircle, chip: 'bg-royal-600/10 text-royal-700', tone: 'text-royal-900' },
    { label: 'Outstanding', value: money(stats.outstanding), icon: Banknote, chip: 'bg-red-50 text-red-600', tone: 'text-red-600' },
  ]

  const methodTotal = stats.byMethod.cash + stats.byMethod.mobile_money + stats.byMethod.bank

  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-royal-900 via-royal-700 to-royal-600 p-6 md:p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold-400/25 blur-2xl" />
        <h1 className="relative text-2xl font-bold text-white md:text-3xl">
          Welcome, <span className="text-gold-400">{firstName}</span>
        </h1>
        <p className="relative mt-1 text-sm text-white/80">
          Record fee payments, issue receipts and keep track of balances.
        </p>
        {period.year && period.term && (
          <p className="relative mt-3 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gold-400">
            {period.term} · {period.year}
          </p>
        )}
        <div className="relative mt-4 h-1 w-20 rounded bg-gold-400" />
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* Stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, chip, tone }) => (
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

      {!loading && (!period.year || !period.term) && (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-royal-900">No current term could be loaded</p>
          <p className="mt-1 text-sm text-gray-500">
            If the admin has already set the term, this account may not have permission to read the school settings.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {period.year && period.term && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              {/* <TrendingUp className="h-4 w-4 text-gold-500" /> */}
              <p className="text-sm font-semibold text-royal-900">Term collection</p>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-3xl font-bold text-royal-900">{loading ? '—' : `${stats.rate}%`}</p>
              <p className="text-xs text-gray-500">of {money(stats.totalDue)} billed</p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${stats.rate}%` }} />
            </div>

            <div className="mt-5 space-y-2">
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => {
                const pct = methodTotal > 0 ? Math.round((stats.byMethod[m] / methodTotal) * 100) : 0
                return (
                  <div key={m} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">
                      {METHOD_LABEL[m]} <span className="text-xs text-gray-400">({pct}%)</span>
                    </span>
                    <span className="font-semibold text-royal-900">{money(stats.byMethod[m])}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className={`rounded-2xl bg-white p-5 shadow-sm ${period.year && period.term ? '' : 'md:col-span-2'}`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-royal-900">Recent payments</p>
            <Link to="/bursar/receipts" className="text-xs font-semibold text-royal-700 hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="mt-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : recent.length === 0 ? (
            <p className="mt-6 text-center text-sm text-gray-500">No payments recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-royal-900">
                      {r.students ? studentName(r.students) : 'Student'}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {r.fee_structures?.item ?? 'Fee'} · {METHOD_LABEL[r.method]} · {timeLabel(r.paid_at)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-royal-900">{money(r.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {QUICK_ACTIONS.map(({ label, desc, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-royal-600/10 text-royal-700">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-royal-900">{label}</p>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}