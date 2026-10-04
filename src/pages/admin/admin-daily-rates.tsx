import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface ClassRow {
  id: string
  name: string
  level_group: string | null
}

const LEVELS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary' },
  { value: 'upper_primary', label: 'Upper Primary' },
  { value: 'jhs', label: 'JHS' },
]

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function AdminDailyRates() {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [school, setSchool] = useState<Record<string, string>>({})
  const [cls, setCls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // bulk helpers
  const [bulkClass, setBulkClass] = useState('1')
  const [bulkSchool, setBulkSchool] = useState('10')
  const [bulkLevels, setBulkLevels] = useState<Set<string>>(new Set(['creche', 'nursery', 'kg']))

  function showToast(type: 'ok' | 'error', text: string) {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    async function load() {
      const [c, r] = await Promise.all([
        supabase.from('classes').select('id, name, level_group'),
        supabase.from('daily_fee_rates').select('class_id, school_fee, class_fee'),
      ])
      if (c.error) showToast('error', c.error.message)
      const order = LEVELS.map((l) => l.value)
      const sorted = ((c.data ?? []) as ClassRow[]).sort(
        (a, b) =>
          order.indexOf(a.level_group ?? '') - order.indexOf(b.level_group ?? '') ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      setClasses(sorted)
      const s: Record<string, string> = {}
      const k: Record<string, string> = {}
      for (const row of sorted) {
        s[row.id] = ''
        k[row.id] = ''
      }
      for (const row of r.data ?? []) {
        s[row.class_id] = Number(row.school_fee) > 0 ? String(Number(row.school_fee)) : ''
        k[row.class_id] = Number(row.class_fee) > 0 ? String(Number(row.class_fee)) : ''
      }
      setSchool(s)
      setCls(k)
      setLoading(false)
    }
    void load()
  }, [])

  const levelLabel = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l.value, l.label])), [])

  function applyClassFee() {
    const v = Number(bulkClass)
    if (bulkClass === '' || Number.isNaN(v) || v < 0) return showToast('error', 'Enter a valid class fee')
    setCls(Object.fromEntries(classes.map((c) => [c.id, String(v)])))
  }

  function applySchoolFee() {
    const v = Number(bulkSchool)
    if (bulkSchool === '' || Number.isNaN(v) || v < 0) return showToast('error', 'Enter a valid school fee')
    if (bulkLevels.size === 0) return showToast('error', 'Tick at least one level')
    setSchool((prev) => {
      const next = { ...prev }
      for (const c of classes) if (c.level_group && bulkLevels.has(c.level_group)) next[c.id] = String(v)
      return next
    })
  }

  async function save() {
    const rows = []
    for (const c of classes) {
      const sf = school[c.id] === '' ? 0 : Number(school[c.id])
      const cf = cls[c.id] === '' ? 0 : Number(cls[c.id])
      if (Number.isNaN(sf) || Number.isNaN(cf) || sf < 0 || cf < 0) return showToast('error', `Check the amounts for ${c.name}`)
      rows.push({ class_id: c.id, school_fee: sf, class_fee: cf, updated_at: new Date().toISOString() })
    }
    setSaving(true)
    const { error } = await supabase.from('daily_fee_rates').upsert(rows, { onConflict: 'class_id' })
    setSaving(false)
    if (error) return showToast('error', error.message)
    showToast('ok', 'Daily rates saved')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/admin/fees" className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Fees
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-royal-900">Daily rates</h1>
      <p className="mt-1 text-sm text-gray-500">
        What each pupil pays per day, per class. The bursar&apos;s Daily Collections page multiplies these by the number of pupils
        present. Leave a box empty if the class doesn&apos;t pay that fee.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-royal-900">Daily class fee, every class</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="number" min="0" step="0.01" value={bulkClass} onChange={(e) => setBulkClass(e.target.value)} className={`${inputClass} w-28`} />
            <button onClick={applyClassFee} className="rounded-lg border border-royal-200 px-3 py-2 text-xs font-semibold text-royal-700 hover:bg-royal-50">
              Fill all classes
            </button>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-royal-900">Daily school fee, chosen levels</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {LEVELS.map((l) => (
              <label key={l.value} className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  className="accent-royal-600"
                  checked={bulkLevels.has(l.value)}
                  onChange={() =>
                    setBulkLevels((prev) => {
                      const next = new Set(prev)
                      if (next.has(l.value)) next.delete(l.value)
                      else next.add(l.value)
                      return next
                    })
                  }
                />
                {l.label}
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="number" min="0" step="0.01" value={bulkSchool} onChange={(e) => setBulkSchool(e.target.value)} className={`${inputClass} w-28`} />
            <button onClick={applySchoolFee} className="rounded-lg border border-royal-200 px-3 py-2 text-xs font-semibold text-royal-700 hover:bg-royal-50">
              Fill these levels
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">Basic 1 sits in Lower Primary with Basic 2–3, so set its school fee in the table below.</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold">Level</th>
              <th className="px-4 py-3 text-right font-semibold">School fee / day (GH₵)</th>
              <th className="px-4 py-3 text-right font-semibold">Class fee / day (GH₵)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : classes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-500">
                  No classes yet. Add them on the Class page first.
                </td>
              </tr>
            ) : (
              classes.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium text-royal-900">{c.name}</td>
                  <td className="px-4 py-2 text-gray-500">{c.level_group ? levelLabel[c.level_group] ?? c.level_group : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={school[c.id] ?? ''}
                      onChange={(e) => setSchool((p) => ({ ...p, [c.id]: e.target.value }))}
                      className={`${inputClass} w-28 text-right`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cls[c.id] ?? ''}
                      onChange={(e) => setCls((p) => ({ ...p, [c.id]: e.target.value }))}
                      className={`${inputClass} w-28 text-right`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => void save()}
          disabled={saving || loading}
          className="flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save rates
        </button>
      </div>

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
