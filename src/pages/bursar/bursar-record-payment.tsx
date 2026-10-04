import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Banknote,
  Smartphone,
  Landmark,
  UserRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  admissionNo,
  money,
  studentName,
  type Method,
  type Receipt,
} from '@/components/fees/fee-utils'
import ReceiptModal from '@/components/fees/receipt-modal'

/* ---------- types ---------- */

// The students table is read with select('*') so the page works whatever the
// name columns are called; see studentName() / admissionNo() below.
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

const METHODS: { value: Method; label: string; icon: typeof Banknote }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'mobile_money', label: 'Mobile money', icon: Smartphone },
  { value: 'bank', label: 'Bank', icon: Landmark },
]

/* ---------- helpers ---------- */

const periodKey = (year: string, term: string) => `${year}|${term}`

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function StatusChip({ row }: { row: BalanceRow }) {
  if (row.balance <= 0)
    return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Paid</span>
  if (row.amount_paid > 0)
    return <span className="rounded-full bg-gold-400/25 px-2.5 py-0.5 text-xs font-semibold text-royal-900">Partial</span>
  return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">Owing</span>
}

/* ---------- page ---------- */

export default function BursarRecordPayment() {
  const { profile } = useAuth()

  const [students, setStudents] = useState<StudentRow[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [current, setCurrent] = useState<{ year: string | null; term: string | null }>({ year: null, term: null })

  const [query, setQuery] = useState('')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [period, setPeriod] = useState<string>('')

  // payment form
  const [feeId, setFeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  function showToast(text: string) {
    window.clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  /* ----- load students and current term once ----- */
  useEffect(() => {
    async function init() {
      const [{ data: studs }, { data: settings }] = await Promise.all([
        supabase.from('students').select('*, classes(name)'),
        supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
      ])
      setStudents((studs ?? []) as unknown as StudentRow[])
      if (settings) setCurrent({ year: settings.current_academic_year, term: settings.current_term })
      setLoadingStudents(false)
    }
    void init()
  }, [])

  /* ----- balances for the selected student ----- */
  const loadBalances = useCallback(
    async (studentId: string) => {
      setLoadingBalances(true)
      const { data } = await supabase
        .from('student_fee_balances')
        .select('student_id, fee_structure_id, academic_year, term, item, amount_due, amount_paid, balance')
        .eq('student_id', studentId)
      const rows = ((data ?? []) as BalanceRow[]).map((r) => ({
        ...r,
        amount_due: Number(r.amount_due),
        amount_paid: Number(r.amount_paid),
        balance: Number(r.balance),
      }))
      setBalances(rows)
      setLoadingBalances(false)

      // default to the current term if it has fees, otherwise the latest period
      const keys = [...new Set(rows.map((r) => periodKey(r.academic_year, r.term)))].sort()
      const currentKey = current.year && current.term ? periodKey(current.year, current.term) : ''
      setPeriod((prev) => (prev && keys.includes(prev) ? prev : keys.includes(currentKey) ? currentKey : (keys[keys.length - 1] ?? '')))
    },
    [current.year, current.term],
  )

  function pickStudent(s: StudentRow) {
    setStudent(s)
    setQuery('')
    setFeeId('')
    setAmount('')
    setReference('')
    setNote('')
    setMethod('cash')
    setFormError(null)
    setPeriod('')
    void loadBalances(s.id)
  }

  function clearStudent() {
    setStudent(null)
    setBalances([])
    setFeeId('')
    setAmount('')
    setFormError(null)
  }

  /* ----- derived ----- */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return students
      .filter((s) => studentName(s).toLowerCase().includes(q) || admissionNo(s).toLowerCase().includes(q))
      .slice(0, 8)
  }, [students, query])

  const periods = useMemo(
    () =>
      [...new Set(balances.map((r) => periodKey(r.academic_year, r.term)))]
        .sort()
        .map((k) => ({ key: k, label: `${k.split('|')[1]}, ${k.split('|')[0]}` })),
    [balances],
  )

  const periodRows = useMemo(
    () =>
      balances
        .filter((r) => periodKey(r.academic_year, r.term) === period)
        .sort((a, b) => a.item.localeCompare(b.item)),
    [balances, period],
  )

  // Arrears: unpaid items from any term before the selected one (keys sort as year, then term)
  const arrearsRows = useMemo(
    () =>
      period
        ? balances
            .filter((r) => r.balance > 0 && periodKey(r.academic_year, r.term) < period)
            .sort(
              (a, b) =>
                periodKey(a.academic_year, a.term).localeCompare(periodKey(b.academic_year, b.term)) ||
                a.item.localeCompare(b.item),
            )
        : [],
    [balances, period],
  )
  const arrearsTotal = arrearsRows.reduce((sum, r) => sum + r.balance, 0)
  const arrearsTerms = new Set(arrearsRows.map((r) => periodKey(r.academic_year, r.term))).size

  const currentPayable = useMemo(() => periodRows.filter((r) => r.balance > 0), [periodRows])
  // Oldest arrears first, then this term's items. Paying an arrears item is recorded
  // against its original term, so receipts and the ledger stay accurate.
  const payable = useMemo(() => [...arrearsRows, ...currentPayable], [arrearsRows, currentPayable])
  const selectedFee = payable.find((r) => r.fee_structure_id === feeId) ?? null
  const totalBalance = periodRows.reduce((sum, r) => sum + r.balance, 0) + arrearsTotal

  // keep the selected fee valid when the term changes
  useEffect(() => {
    if (feeId && !payable.some((r) => r.fee_structure_id === feeId)) {
      setFeeId('')
      setAmount('')
    }
  }, [feeId, payable])

  function onFeeChange(id: string) {
    setFeeId(id)
    const row = payable.find((r) => r.fee_structure_id === id)
    setAmount(row ? String(row.balance) : '')
    setFormError(null)
  }

  /* ----- submit ----- */
  async function recordPayment() {
    if (!student || !profile) return
    if (!selectedFee) return setFormError('Choose the fee item being paid')

    const value = Number(amount)
    if (!amount || Number.isNaN(value) || value <= 0) return setFormError('Enter a valid amount')
    if (value > selectedFee.balance)
      return setFormError(`The amount is more than the balance of ${money(selectedFee.balance)}`)
    if (method !== 'cash' && !reference.trim())
      return setFormError('Enter the transaction reference for mobile money or bank payments')

    setSaving(true)
    setFormError(null)
    const { data, error } = await supabase
      .from('fee_payments')
      .insert({
        student_id: student.id,
        fee_structure_id: selectedFee.fee_structure_id,
        amount: value,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
        received_by: profile.id,
      })
      .select('receipt_no, paid_at')
      .single()
    setSaving(false)

    if (error || !data) {
      return setFormError(error?.message ?? 'Could not record the payment. Please try again.')
    }

    setReceipt({
      receiptNo: data.receipt_no,
      paidAt: data.paid_at,
      amount: value,
      method,
      reference: reference.trim() || null,
      item: selectedFee.item,
      term: selectedFee.term,
      year: selectedFee.academic_year,
      studentName: studentName(student),
      admissionNo: admissionNo(student),
      className: student.classes?.name ?? '',
      balanceAfter: selectedFee.balance - value,
      receivedBy: profile.full_name || profile.username || 'Bursar',
      status: 'valid',
    })

    setFeeId('')
    setAmount('')
    setReference('')
    setNote('')
    await loadBalances(student.id)
  }

  function closeReceipt() {
    setReceipt(null)
    showToast('Payment recorded')
  }

  function onSmsResult(r: { ok: boolean; message: string }) {
    showToast(r.ok ? 'Payment recorded · SMS sent to guardian' : `Payment recorded · ${r.message}`)
  }

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-royal-900">Record Payment</h1>
      <p className="mt-1 text-sm text-gray-500">Find a student, choose what is being paid, and issue a receipt.</p>

      {/* Step 1: student */}
      <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        {!student ? (
          <>
            <label className="block text-sm font-medium text-royal-900">Student</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={loadingStudents ? 'Loading students...' : 'Search by name or admission number'}
                disabled={loadingStudents}
                className={`${inputClass} pl-9`}
                autoFocus
              />
            </div>

            {query.trim().length >= 2 && (
              <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                {results.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-gray-500">No student found</li>
                ) : (
                  results.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => pickStudent(s)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-royal-50"
                      >
                        <span className="text-sm font-medium text-royal-900">{studentName(s)}</span>
                        <span className="text-xs text-gray-500">
                          {admissionNo(s)}
                          {admissionNo(s) && s.classes?.name ? ' · ' : ''}
                          {s.classes?.name}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-royal-600 text-white">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-royal-900">{studentName(student)}</p>
              <p className="text-xs text-gray-500">
                {admissionNo(student)}
                {admissionNo(student) && student.classes?.name ? ' · ' : ''}
                {student.classes?.name}
              </p>
            </div>
            <button
              onClick={clearStudent}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-royal-600 hover:bg-royal-50"
            >
              Change
            </button>
          </div>
        )}
      </div>

      {/* Step 2: balances */}
      {student && (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-royal-900">Fees</h2>
            {periods.length > 0 && (
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${inputClass} w-48`}>
                {periods.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loadingBalances ? (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-gray-400" />
          ) : periodRows.length === 0 && arrearsRows.length === 0 ? (
            <p className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
              No fees have been set for this student&apos;s class yet. Ask the administrator to add them on the Fees page.
            </p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 font-semibold">Item</th>
                      <th className="py-2 text-right font-semibold">Due</th>
                      <th className="py-2 text-right font-semibold">Paid</th>
                      <th className="py-2 text-right font-semibold">Balance</th>
                      <th className="py-2 text-right font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodRows.map((r) => (
                      <tr key={r.fee_structure_id} className="border-t border-gray-100">
                        <td className="py-2.5 font-medium text-royal-900">{r.item}</td>
                        <td className="py-2.5 text-right">{money(r.amount_due)}</td>
                        <td className="py-2.5 text-right">{money(r.amount_paid)}</td>
                        <td className="py-2.5 text-right font-semibold">{money(r.balance)}</td>
                        <td className="py-2.5 text-right">
                          <StatusChip row={r} />
                        </td>
                      </tr>
                    ))}
                    {arrearsRows.length > 0 && (
                      <tr className="border-t border-gray-100 bg-amber-50/70">
                        <td className="py-2.5 font-medium text-royal-900">
                          Arrears b/f
                          <span className="block text-xs font-normal text-gray-500">
                            Unpaid from {arrearsTerms} previous term{arrearsTerms > 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">{money(arrearsTotal)}</td>
                        <td className="py-2.5 text-right">{money(0)}</td>
                        <td className="py-2.5 text-right font-semibold">{money(arrearsTotal)}</td>
                        <td className="py-2.5 text-right">
                          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">Owing</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {arrearsRows.length > 0 && (
                <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Arrears breakdown</p>
                  <ul className="mt-1 space-y-0.5">
                    {arrearsRows.map((r) => (
                      <li key={r.fee_structure_id} className="flex justify-between gap-3">
                        <span>
                          {r.item} · {r.term}, {r.academic_year}
                        </span>
                        <span className="font-semibold">{money(r.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-3 text-right text-sm text-gray-600">
                {arrearsRows.length > 0 ? 'Total payable (incl. arrears)' : 'Total balance'}:{' '}
                <span className="font-bold text-royal-900">{money(totalBalance)}</span>
              </p>
            </>
          )}
        </div>
      )}

      {/* Step 3: payment form */}
      {student && payable.length > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-royal-900">New payment</h2>

          <label className="mt-4 block text-sm font-medium text-royal-900">Fee item</label>
          <select value={feeId} onChange={(e) => onFeeChange(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">Select fee item</option>
            {arrearsRows.length > 0 && (
              <optgroup label="Arrears (previous terms)">
                {arrearsRows.map((r) => (
                  <option key={r.fee_structure_id} value={r.fee_structure_id}>
                    {r.item} · {r.term}, {r.academic_year}: balance {money(r.balance)}
                  </option>
                ))}
              </optgroup>
            )}
            {currentPayable.length > 0 && (
              <optgroup label={arrearsRows.length > 0 ? 'This term' : 'Fee items'}>
                {currentPayable.map((r) => (
                  <option key={r.fee_structure_id} value={r.fee_structure_id}>
                    {r.item}: balance {money(r.balance)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {arrearsRows.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">This student has arrears. Clear the oldest balance first.</p>
          )}

          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-royal-900">Amount (GH₵)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${inputClass} mt-1`}
              />
            </div>
            {selectedFee && (
              <button
                type="button"
                onClick={() => setAmount(String(selectedFee.balance))}
                className="rounded-lg border border-royal-200 px-3 py-2 text-xs font-semibold text-royal-700 hover:bg-royal-50"
              >
                Full balance
              </button>
            )}
          </div>

          <label className="mt-4 block text-sm font-medium text-royal-900">Payment method</label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-semibold transition ${
                  method === value
                    ? 'bg-royal-600 text-white shadow'
                    : 'bg-gray-50 text-gray-600 hover:bg-royal-50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          {method !== 'cash' && (
            <>
              <label className="mt-4 block text-sm font-medium text-royal-900">Transaction reference</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === 'mobile_money' ? 'MoMo transaction ID' : 'Bank slip / reference number'}
                className={`${inputClass} mt-1`}
              />
            </>
          )}

          <label className="mt-4 block text-sm font-medium text-royal-900">
            Note <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Paid by guardian"
            className={`${inputClass} mt-1`}
          />

          {formError && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <button
            onClick={() => void recordPayment()}
            className="mt-5 w-full rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700"
          >
            Record payment and issue receipt
          </button>
        </div>
      )}

      {/* Receipt */}
      {receipt && <ReceiptModal receipt={receipt} onClose={closeReceipt} sendSms onSmsResult={onSmsResult} />}

      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/30 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}
    </div>
  )
}