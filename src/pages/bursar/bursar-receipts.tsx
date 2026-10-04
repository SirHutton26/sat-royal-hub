import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Loader2, Eye, Ban, X, AlertCircle, CheckCircle2, Banknote, Smartphone, Landmark } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  admissionNo,
  METHOD_LABEL,
  money,
  studentName,
  type Method,
  type Receipt,
} from '@/components/fees/fee-utils'
import ReceiptModal from '@/components/fees/receipt-modal'
import ProvisionalReceipts from '@/components/offline/provisional-receipts'

/* ---------- types ---------- */

interface PaymentRow {
  id: string
  receipt_no: string
  amount: number
  method: Method
  reference: string | null
  note: string | null
  paid_at: string
  status: 'valid' | 'void'
  void_reason: string | null
  student_id: string
  fee_structure_id: string
  students: ({ classes: { name: string } | null } & Record<string, unknown>) | null
  fee_structures: { item: string; term: string; academic_year: string; amount: number } | null
  received: { full_name: string | null } | null
}

type Range = 'today' | 'week' | 'month' | 'all'

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

function rangeStart(range: Range): string | null {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (range === 'all') return null
  if (range === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
  if (range === 'month') d.setDate(1)
  return d.toISOString()
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/* ---------- page ---------- */

export default function BursarReceipts() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('today')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'void'>('all')

  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [opening, setOpening] = useState(false)

  const [toVoid, setToVoid] = useState<PaymentRow | null>(null)
  const [reason, setReason] = useState('')
  const [voidError, setVoidError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  function showToast(type: 'ok' | 'error', text: string) {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 3000)
  }

  /* ----- load payments for the chosen period ----- */
  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('fee_payments')
      .select(
        'id, receipt_no, amount, method, reference, note, paid_at, status, void_reason, student_id, fee_structure_id, ' +
          'students(*, classes(name)), fee_structures(item, term, academic_year, amount), ' +
          'received:profiles!fee_payments_received_by_fkey(full_name)',
      )
      .order('paid_at', { ascending: false })
      .limit(500)

    const start = rangeStart(range)
    if (start) q = q.gte('paid_at', start)

    const { data, error } = await q
    if (error) showToast('error', error.message)
    setRows(((data ?? []) as unknown as PaymentRow[]).map((r) => ({ ...r, amount: Number(r.amount) })))
    setLoading(false)
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  /* ----- derived ----- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter))
      .filter((r) => {
        if (!q) return true
        const name = r.students ? studentName(r.students).toLowerCase() : ''
        return (
          r.receipt_no.toLowerCase().includes(q) ||
          name.includes(q) ||
          (r.fee_structures?.item ?? '').toLowerCase().includes(q)
        )
      })
  }, [rows, search, statusFilter])

  // Totals count valid payments only, so voided money never inflates the figures
  const totals = useMemo(() => {
    const t: Record<Method, number> = { cash: 0, mobile_money: 0, bank: 0 }
    for (const r of rows) if (r.status === 'valid') t[r.method] += r.amount
    return t
  }, [rows])
  const grandTotal = totals.cash + totals.mobile_money + totals.bank
  const voidCount = rows.filter((r) => r.status === 'void').length

  /* ----- view / reprint ----- */
  async function openReceipt(r: PaymentRow) {
    setOpening(true)
    const { data } = await supabase
      .from('fee_payments')
      .select('amount')
      .eq('student_id', r.student_id)
      .eq('fee_structure_id', r.fee_structure_id)
      .eq('status', 'valid')
      .lte('paid_at', r.paid_at)
    const paidSoFar = (data ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
    setOpening(false)

    setReceipt({
      receiptNo: r.receipt_no,
      paidAt: r.paid_at,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      item: r.fee_structures?.item ?? '',
      term: r.fee_structures?.term ?? '',
      year: r.fee_structures?.academic_year ?? '',
      studentName: r.students ? studentName(r.students) : 'Unknown student',
      admissionNo: r.students ? admissionNo(r.students) : '',
      className: r.students?.classes?.name ?? '',
      balanceAfter: Number(r.fee_structures?.amount ?? 0) - paidSoFar,
      receivedBy: r.received?.full_name || 'Bursar',
      status: r.status,
      voidReason: r.void_reason,
    })
  }

  /* ----- void ----- */
  function openVoid(r: PaymentRow) {
    setToVoid(r)
    setReason('')
    setVoidError(null)
  }

  async function confirmVoid() {
    if (!toVoid) return
    if (reason.trim().length < 5) return setVoidError('Please give a clear reason (at least 5 characters)')

    setSaving(true)
    const { error } = await supabase
      .from('fee_payments')
      .update({ status: 'void', void_reason: reason.trim() })
      .eq('id', toVoid.id)
    setSaving(false)

    if (error) return setVoidError(error.message)
    setToVoid(null)
    showToast('ok', `Receipt ${toVoid.receipt_no} voided`)
    await load()
  }

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Receipts</h1>
      <p className="mt-1 text-sm text-gray-500">Look up payments, reprint receipts and void mistakes.</p>
      <ProvisionalReceipts />

      {/* Period + totals */}
      <div className="mt-5 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              range === r.value ? 'bg-royal-600 text-white shadow' : 'bg-white text-gray-600 hover:bg-royal-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-royal-900 to-royal-600 p-4 text-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-white/70">Total collected</p>
          <p className="mt-1 text-xl font-bold text-gold-400">{money(grandTotal)}</p>
          {voidCount > 0 && <p className="mt-1 text-[11px] text-white/70">{voidCount} voided (not counted)</p>}
        </div>
        {(
          [
            ['cash', Banknote],
            ['mobile_money', Smartphone],
            ['bank', Landmark],
          ] as const
        ).map(([m, Icon]) => (
          <div key={m} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
              <Icon className="h-4 w-4 text-royal-600" />
              {METHOD_LABEL[m]}
            </div>
            <p className="mt-1 text-xl font-bold text-royal-900">{money(totals[m])}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt no, student or fee item"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'valid' | 'void')}
          className={`${inputClass} w-36`}
        >
          <option value="all">All</option>
          <option value="valid">Valid</option>
          <option value="void">Voided</option>
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">Receipt</th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Method</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  No payments found for this period.
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const isVoid = r.status === 'void'
                return (
                  <tr key={r.id} className={`border-t border-gray-100 ${isVoid ? 'bg-red-50/40' : 'hover:bg-royal-50/60'}`}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-royal-900">
                      {r.receipt_no}
                      {isVoid && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase text-red-600">
                          Void
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {new Date(r.paid_at).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-royal-900">{r.students ? studentName(r.students) : '—'}</p>
                      <p className="text-xs text-gray-500">{r.students?.classes?.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.fee_structures?.item}
                      <p className="text-xs text-gray-500">
                        {r.fee_structures?.term}, {r.fee_structures?.academic_year}
                      </p>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        isVoid ? 'text-gray-400 line-through' : 'text-royal-900'
                      }`}
                    >
                      {money(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{METHOD_LABEL[r.method]}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => void openReceipt(r)}
                          aria-label="View receipt"
                          className="rounded-md p-2 text-royal-600 transition hover:bg-royal-50"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {!isVoid && (
                          <button
                            onClick={() => openVoid(r)}
                            aria-label="Void payment"
                            className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length >= 500 && (
        <p className="mt-2 text-xs text-gray-500">Showing the latest 500 payments. Narrow the period to see fewer.</p>
      )}

      {/* Receipt */}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}

      {/* Void dialog */}
      {toVoid && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <button
              onClick={() => setToVoid(null)}
              aria-label="Close"
              className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold text-royal-900">Void this payment?</h2>
            <p className="mt-2 text-sm text-gray-600">
              {toVoid.receipt_no} · {money(toVoid.amount)} for{' '}
              {toVoid.students ? studentName(toVoid.students) : 'this student'}. The student&apos;s balance will go
              back up by this amount. This cannot be undone. If the payment was real, record a new one afterwards.
            </p>

            <label className="mt-4 block text-sm font-medium text-royal-900">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Wrong amount entered"
              className={`${inputClass} mt-1`}
            />

            {voidError && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {voidError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setToVoid(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmVoid()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Void payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spinner overlay */}
      {(saving || opening) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/30 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {toast.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}