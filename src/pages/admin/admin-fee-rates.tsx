import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const LEVELS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary' },
  { value: 'upper_primary', label: 'Upper Primary' },
  { value: 'jhs', label: 'JHS' },
]

// key = kind|level_group ('' for one rate for everyone)
const key = (kind: string, level: string) => `${kind}|${level}`
const inputClass = 'w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-right text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function AdminFeeRates() {
  const [v, setV] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void supabase.from('fee_rates').select('kind, level_group, amount').then(({ data, error }) => {
      if (error) setMsg({ ok: false, text: error.message })
      const o: Record<string, string> = {}
      for (const r of data ?? []) o[key(r.kind, r.level_group)] = String(Number(r.amount))
      setV(o)
      setLoading(false)
    })
  }, [])

  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }))

  async function save() {
    const keys = [...LEVELS.flatMap((l) => [key('feeding', l.value), key('ict', l.value)]), key('extra', '')]
    const up: { kind: string; level_group: string; amount: number }[] = []
    const del: string[][] = []
    for (const k of keys) {
      const [kind, level] = k.split('|')
      const raw = (v[k] ?? '').trim()
      if (raw === '') { del.push([kind, level]); continue }
      const n = Number(raw)
      if (Number.isNaN(n) || n < 0) return setMsg({ ok: false, text: 'Enter valid amounts (0 or more)' })
      up.push({ kind, level_group: level, amount: n })
    }
    setSaving(true)
    setMsg(null)
    let err = up.length ? (await supabase.from('fee_rates').upsert(up, { onConflict: 'kind,level_group' })).error : null
    for (const [kind, level] of del) if (!err) err = (await supabase.from('fee_rates').delete().eq('kind', kind).eq('level_group', level)).error
    setSaving(false)
    setMsg(err ? { ok: false, text: err.message } : { ok: true, text: 'Rates saved' })
  }

  const row = (label: string, k: string) => (
    <div key={k} className="flex items-center justify-between py-2">
      <span className="text-sm text-royal-900">{label}</span>
      <input type="number" min="0" step="0.01" value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder="0.00" className={inputClass} />
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/admin/fees" className="mb-2 flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Fees</Link>
      <h1 className="text-2xl font-bold text-royal-900">Daily &amp; weekly fees</h1>
      <p className="mt-1 text-sm text-gray-500">
        These rates appear exactly as entered in the FEES REMINDER on the report card (feeding and extra classes per day, ICT per week). Leave a rate empty if it does not apply.
      </p>

      {loading ? (
        <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-royal-600" />
      ) : (
        <>
          <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-royal-900">Feeding fee <span className="text-xs font-normal text-gray-500">GH₵ per day, by level</span></h2>
            <div className="divide-y divide-gray-100">{LEVELS.map((l) => row(l.label, key('feeding', l.value)))}</div>
          </section>
          <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-royal-900">Extra classes <span className="text-xs font-normal text-gray-500">GH₵ per day, same for all</span></h2>
            <div className="divide-y divide-gray-100">{row('All classes', key('extra', ''))}</div>
          </section>
          <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-royal-900">ICT fee <span className="text-xs font-normal text-gray-500">GH₵ per week, by level</span></h2>
            <div className="divide-y divide-gray-100">{LEVELS.map((l) => row(l.label, key('ict', l.value)))}</div>
          </section>

          {msg && (
            <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
            </p>
          )}
          <button onClick={() => void save()} disabled={saving} className="mt-4 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rates
          </button>
        </>
      )}
    </div>
  )
}
