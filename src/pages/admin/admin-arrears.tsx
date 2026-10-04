import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ArrowLeft,
  Plus,
  Upload,
  Download,
  Pencil,
  Trash2,
  Search,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  UserRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ---------- types & constants ---------- */

interface Student {
  id: string
  full_name: string
  admission_number: string
  class_id: string | null
  is_active: boolean
  classes: { name: string } | null
}

interface ArrearRow {
  id: string
  student_id: string
  academic_year: string
  term: string
  item: string
  amount: number
  students: Student | null
}

interface ImportPreview {
  ok: { student: Student; amount: number }[]
  unmatched: string[]
  invalid: string[]
}

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const ITEM_SUGGESTIONS = ['Opening balance', 'School Fees', 'Exam Fees']
const CONFLICT_KEY = 'student_id,academic_year,term,item'

function currentStartYear() {
  const d = new Date()
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
}

// Default "owed from" period: the term before the current academic year starts
function defaultFromYear() {
  const y = currentStartYear() - 1
  return `${y}/${y + 1}`
}

function yearOptions(extra: string) {
  const start = currentStartYear()
  const base = [start - 2, start - 1, start].map((n) => `${n}/${n + 1}`)
  return base.includes(extra) ? base : [...base, extra].sort()
}

const money = (n: number) =>
  'GH₵ ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function parseAmount(raw: string | undefined) {
  const n = Number(String(raw ?? '').replace(/[^0-9.\-]/g, ''))
  return raw && !Number.isNaN(n) ? n : NaN
}

function chunk<T>(list: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

/* ---------- page ---------- */

export default function AdminArrears() {
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<ArrearRow[]>([])
  const [paidBy, setPaidBy] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // the period the money is owed FROM, and what to call it
  const [fromYear, setFromYear] = useState(defaultFromYear())
  const [fromTerm, setFromTerm] = useState('Term 3')
  const [itemName, setItemName] = useState('Opening balance')

  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; row: ArrearRow }>(null)
  const [toDelete, setToDelete] = useState<ArrearRow | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // add / edit form
  const [studentQuery, setStudentQuery] = useState('')
  const [picked, setPicked] = useState<Student | null>(null)
  const [amount, setAmount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const toastTimer = useRef<number | undefined>(undefined)
  function showToast(type: 'ok' | 'error', text: string) {
    window.clearTimeout(toastTimer.current)
    setToast({ type, text })
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  /* ----- students (once) ----- */
  useEffect(() => {
    async function init() {
      const { data } = await supabase
        .from('students')
        .select('id, full_name, admission_number, class_id, is_active, classes(name)')
        .order('full_name')
      setStudents((data ?? []) as unknown as Student[])
    }
    void init()
  }, [])

  /* ----- existing opening balances for the chosen period ----- */
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fee_structures')
      .select(
        'id, student_id, academic_year, term, item, amount, students(id, full_name, admission_number, class_id, is_active, classes(name))',
      )
      .not('student_id', 'is', null)
      .eq('academic_year', fromYear)
      .eq('term', fromTerm)
    if (error) showToast('error', error.message)

    const list = ((data ?? []) as unknown as ArrearRow[]).map((r) => ({ ...r, amount: Number(r.amount) }))
    setRows(list)

    // how much of each has already been paid
    const paid = new Map<string, number>()
    for (const ids of chunk(
      list.map((r) => r.id),
      100,
    )) {
      const { data: bal } = await supabase
        .from('student_fee_balances')
        .select('fee_structure_id, amount_paid')
        .in('fee_structure_id', ids)
      for (const b of bal ?? []) paid.set(b.fee_structure_id, Number(b.amount_paid))
    }
    setPaidBy(paid)
    setLoading(false)
  }, [fromYear, fromTerm])

  useEffect(() => {
    void load()
  }, [load])

  /* ----- derived ----- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter(
        (r) =>
          !q ||
          (r.students?.full_name ?? '').toLowerCase().includes(q) ||
          (r.students?.admission_number ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (a.students?.full_name ?? '').localeCompare(b.students?.full_name ?? ''))
  }, [rows, search])

  const totalOwed = rows.reduce((s, r) => s + r.amount, 0)
  const totalPaid = rows.reduce((s, r) => s + (paidBy.get(r.id) ?? 0), 0)

  const matches = useMemo(() => {
    const q = studentQuery.trim().toLowerCase()
    if (q.length < 2) return []
    return students
      .filter((s) => s.full_name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q))
      .slice(0, 6)
  }, [students, studentQuery])

  /* ----- add / edit ----- */
  function openAdd() {
    setStudentQuery('')
    setPicked(null)
    setAmount('')
    setFormError(null)
    setModal({ mode: 'add' })
  }

  function openEdit(row: ArrearRow) {
    setAmount(String(row.amount))
    setFormError(null)
    setModal({ mode: 'edit', row })
  }

  async function saveForm() {
    const value = Number(amount)
    if (amount === '' || Number.isNaN(value) || value <= 0) return setFormError('Enter an amount greater than zero')
    const name = itemName.trim()
    if (!name) return setFormError('Enter a name for this balance')

    setSaving(true)
    if (modal?.mode === 'add') {
      if (!picked) {
        setSaving(false)
        return setFormError('Choose a student')
      }
      const { error } = await supabase
        .from('fee_structures')
        .upsert(
          { student_id: picked.id, academic_year: fromYear, term: fromTerm, item: name, amount: value },
          { onConflict: CONFLICT_KEY },
        )
      setSaving(false)
      if (error) return setFormError(error.message)
      showToast('ok', `Opening balance saved for ${picked.full_name}`)
    } else if (modal?.mode === 'edit') {
      const paid = paidBy.get(modal.row.id) ?? 0
      if (value < paid) {
        setSaving(false)
        return setFormError(`${money(paid)} has already been paid, so the amount can't be lower than that.`)
      }
      const { error } = await supabase.from('fee_structures').update({ amount: value }).eq('id', modal.row.id)
      setSaving(false)
      if (error) return setFormError(error.message)
      showToast('ok', 'Opening balance updated')
    }
    setModal(null)
    await load()
  }

  async function confirmDelete() {
    if (!toDelete) return
    setSaving(true)
    const { error } = await supabase.from('fee_structures').delete().eq('id', toDelete.id)
    setSaving(false)
    if (error) {
      showToast(
        'error',
        error.code === '23503' ? 'Payments have already been recorded on this balance, so it cannot be deleted' : error.message,
      )
    } else {
      showToast('ok', 'Opening balance removed')
      await load()
    }
    setToDelete(null)
  }

  /* ----- CSV ----- */
  function downloadTemplate() {
    const blob = new Blob(['admission number,amount\n'], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'opening-balances-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const byNumber = new Map(students.map((s) => [s.admission_number.trim().toLowerCase(), s]))
        const latest = new Map<string, { student: Student; amount: number }>() // last row wins per student
        const unmatched: string[] = []
        const invalid: string[] = []

        for (const row of result.data) {
          const number = (row['admission number'] || row['admission_number'] || row['admission #'] || '').trim()
          if (!number) continue
          const amt = parseAmount(row['amount'] || row['balance'] || row['owing'] || row['arrears'])
          const student = byNumber.get(number.toLowerCase())
          if (!student) unmatched.push(number)
          else if (Number.isNaN(amt) || amt <= 0) invalid.push(`${number} (amount "${row['amount'] ?? ''}")`)
          else latest.set(student.id, { student, amount: amt })
        }
        setPreview({ ok: [...latest.values()], unmatched, invalid })
      },
      error: () => showToast('error', 'Could not read that CSV file.'),
    })
  }

  async function confirmImport() {
    if (!preview || preview.ok.length === 0) return
    const name = itemName.trim()
    if (!name) return showToast('error', 'Enter a name for this balance first')

    setSaving(true)
    let failure: string | null = null
    for (const part of chunk(preview.ok, 200)) {
      const { error } = await supabase.from('fee_structures').upsert(
        part.map(({ student, amount: amt }) => ({
          student_id: student.id,
          academic_year: fromYear,
          term: fromTerm,
          item: name,
          amount: amt,
        })),
        { onConflict: CONFLICT_KEY },
      )
      if (error) {
        failure = error.message
        break
      }
    }
    setSaving(false)

    if (failure) return showToast('error', failure)
    showToast('ok', `${preview.ok.length} opening balance${preview.ok.length === 1 ? '' : 's'} imported`)
    setPreview(null)
    await load()
  }

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/admin/fees" className="inline-flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to Fees
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Opening balances</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Fees students still owe from before the system started. They appear as <b>Arrears b/f</b> for the
            bursar and in the owing reports, and payments reduce them like any other fee.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-3 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
          >
            <Download className="h-4 w-4" />
            Template
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-3 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
          >
            <Upload className="h-4 w-4" />
            Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={onPickFile} className="hidden" />
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" />
            Add balance
          </button>
        </div>
      </div>

      {/* Owed-from period */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-500">Owed from: academic year</label>
          <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} className={`${inputClass} mt-1 w-40`}>
            {yearOptions(fromYear).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Term</label>
          <select value={fromTerm} onChange={(e) => setFromTerm(e.target.value)} className={`${inputClass} mt-1 w-36`}>
            {TERMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="block text-xs font-medium text-gray-500">Name on the bursar&apos;s screen</label>
          <input
            list="arrears-item-suggestions"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            className={`${inputClass} mt-1`}
          />
          <datalist id="arrears-item-suggestions">
            {ITEM_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Totals */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Students', String(rows.length)],
          ['Total owed', money(totalOwed)],
          ['Paid so far', money(totalPaid)],
          ['Still outstanding', money(totalOwed - totalPaid)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-1 truncate text-lg font-bold text-royal-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or admission number"
          className={`${inputClass} pl-9`}
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">SN</th>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 text-right font-semibold">Owed</th>
              <th className="px-4 py-3 text-right font-semibold">Paid</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
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
                  No opening balances for {fromTerm}, {fromYear}. Click <b>Add balance</b> or <b>Upload CSV</b>.
                </td>
              </tr>
            ) : (
              visible.map((r, i) => {
                const paid = paidBy.get(r.id) ?? 0
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-royal-50/60">
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-royal-900">{r.students?.full_name ?? '—'}</p>
                      <p className="text-xs text-gray-500">
                        {r.students?.admission_number} · {r.item}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.students?.classes?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{money(r.amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{money(paid)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-royal-900">{money(r.amount - paid)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(r)}
                          aria-label="Edit"
                          className="rounded-md p-2 text-royal-600 transition hover:bg-royal-50"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(r)}
                          aria-label="Delete"
                          className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / edit */}
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add opening balance' : 'Edit opening balance'} onClose={() => setModal(null)}>
          <p className="text-xs text-gray-500">
            Owed from {fromTerm}, {fromYear} · {itemName || 'Opening balance'}
          </p>

          {modal.mode === 'add' ? (
            <div className="mt-4">
              <label className="block text-sm font-medium text-royal-900">Student</label>
              {picked ? (
                <div className="mt-1 flex items-center gap-3 rounded-lg bg-royal-50 px-3 py-2">
                  <UserRound className="h-4 w-4 text-royal-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-royal-900">{picked.full_name}</p>
                    <p className="text-xs text-gray-500">
                      {picked.admission_number} · {picked.classes?.name ?? 'No class'}
                    </p>
                  </div>
                  <button onClick={() => setPicked(null)} className="text-xs font-semibold text-royal-600 hover:underline">
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="Search by name or admission number"
                    className={`${inputClass} mt-1`}
                    autoFocus
                  />
                  {studentQuery.trim().length >= 2 && (
                    <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                      {matches.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-gray-500">No student found</li>
                      ) : (
                        matches.map((s) => (
                          <li key={s.id}>
                            <button
                              onClick={() => setPicked(s)}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-royal-50"
                            >
                              <span className="text-sm font-medium text-royal-900">{s.full_name}</span>
                              <span className="text-xs text-gray-500">
                                {s.admission_number} · {s.classes?.name}
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm font-medium text-royal-900">{modal.row.students?.full_name}</p>
          )}

          <label className="mt-4 block text-sm font-medium text-royal-900">Amount owed (GH₵)</label>
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
          {modal.mode === 'add' && (
            <p className="mt-2 text-xs text-gray-500">
              If this student already has an opening balance with this name, it will be updated.
            </p>
          )}

          {formError && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              onClick={() => void saveForm()}
              className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Delete */}
      {toDelete && (
        <Modal title="Remove this balance?" onClose={() => setToDelete(null)}>
          <p className="text-sm text-gray-600">
            {money(toDelete.amount)} for {toDelete.students?.full_name ?? 'this student'} will be removed. Balances that
            already have payments can&apos;t be removed.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setToDelete(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}

      {/* CSV preview */}
      {preview && (
        <Modal title="Review before importing" onClose={() => setPreview(null)}>
          <p className="text-sm text-gray-600">
            {preview.ok.length} balance{preview.ok.length === 1 ? '' : 's'} ready, owed from {fromTerm}, {fromYear} as
            &quot;{itemName.trim() || 'Opening balance'}&quot;. Total{' '}
            <b className="text-royal-900">{money(preview.ok.reduce((s, r) => s + r.amount, 0))}</b>.
          </p>

          {preview.unmatched.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-semibold">{preview.unmatched.length} admission number(s) not found (skipped):</p>
              <p className="mt-1 break-words text-xs">{preview.unmatched.slice(0, 20).join(', ')}{preview.unmatched.length > 20 ? ' …' : ''}</p>
            </div>
          )}
          {preview.invalid.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-semibold">{preview.invalid.length} row(s) with a bad amount (skipped):</p>
              <p className="mt-1 break-words text-xs">{preview.invalid.slice(0, 20).join(', ')}{preview.invalid.length > 20 ? ' …' : ''}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setPreview(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              disabled={preview.ok.length === 0}
              onClick={() => void confirmImport()}
              className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-50"
            >
              Import {preview.ok.length}
            </button>
          </div>
        </Modal>
      )}

      {/* Saving overlay */}
      {saving && (
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