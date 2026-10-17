import { useEffect, useState } from 'react'
import { AlertCircle, CalendarRange, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTermDates } from '@/lib/terms'

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'
const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Admin: the dates each term starts and ends, and school holidays. Everyone's term totals follow these. */
export default function TermDatesSettings() {
  const { terms, holidays, reload } = useTermDates()
  const [year, setYear] = useState('')
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [hName, setHName] = useState('')
  const [hFrom, setHFrom] = useState('')
  const [hTo, setHTo] = useState('')

  useEffect(() => {
    void supabase.from('school_settings').select('current_academic_year').limit(1).maybeSingle().then(({ data }) => {
      const y = data?.current_academic_year as string | undefined
      if (y) setYear((cur) => cur || y)
    })
  }, [])

  // show what is saved for the chosen year
  useEffect(() => {
    const m: Record<string, { start: string; end: string }> = {}
    for (const t of terms) if (t.academic_year === year) m[t.term] = { start: t.start_date, end: t.end_date }
    setDates(m)
  }, [terms, year])

  const set = (term: string, key: 'start' | 'end', v: string) => setDates((d) => ({ ...d, [term]: { start: d[term]?.start ?? '', end: d[term]?.end ?? '', [key]: v } }))

  async function saveTerms() {
    setMsg(null)
    if (!/^\d{4}\/\d{4}$/.test(year.trim())) return setMsg({ ok: false, text: 'Write the academic year like 2026/2027' })
    const rows = TERMS.filter((t) => dates[t]?.start || dates[t]?.end).map((t) => ({ academic_year: year.trim(), term: t, start_date: dates[t]?.start ?? '', end_date: dates[t]?.end ?? '' }))
    if (rows.some((r) => !r.start_date || !r.end_date)) return setMsg({ ok: false, text: 'Give both a start and an end date for each term you fill in' })
    if (rows.some((r) => r.end_date < r.start_date)) return setMsg({ ok: false, text: 'A term cannot end before it starts' })
    if (!rows.length) return setMsg({ ok: false, text: 'Enter the dates for at least one term' })
    setBusy(true)
    const { error } = await supabase.from('term_dates').upsert(rows, { onConflict: 'academic_year,term' })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setMsg({ ok: true, text: 'Term dates saved' })
    void reload()
  }

  async function addHoliday() {
    setMsg(null)
    if (!hName.trim() || !hFrom) return setMsg({ ok: false, text: 'Give the holiday a name and a date' })
    const end = hTo || hFrom
    if (end < hFrom) return setMsg({ ok: false, text: 'The holiday cannot end before it starts' })
    setBusy(true)
    const { error } = await supabase.from('school_holidays').insert({ name: hName.trim(), start_date: hFrom, end_date: end })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setHName('')
    setHFrom('')
    setHTo('')
    void reload()
  }

  async function removeHoliday(id: string) {
    if (!confirm('Remove this holiday?')) return
    const { error } = await supabase.from('school_holidays').delete().eq('id', id)
    if (error) return setMsg({ ok: false, text: error.message })
    void reload()
  }

  return (
    <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-royal-900">
        <CalendarRange className="h-5 w-5" /> Term dates &amp; holidays
      </h2>
      <p className="mt-1 text-xs text-gray-500">Term totals, clock-in history and the term register use these dates. Holidays are not counted as school days.</p>

      <label className="mt-4 block text-sm font-medium text-royal-900">
        Academic year
        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026/2027" className={`${input} max-w-[10rem]`} />
      </label>

      <div className="mt-3 space-y-3">
        {TERMS.map((t) => (
          <div key={t} className="grid grid-cols-[4.5rem_1fr_1fr] items-end gap-2">
            <span className="pb-2 text-sm font-semibold text-royal-900">{t}</span>
            <label className="text-xs text-gray-500">
              Starts
              <input type="date" value={dates[t]?.start ?? ''} onChange={(e) => set(t, 'start', e.target.value)} className={input} />
            </label>
            <label className="text-xs text-gray-500">
              Ends
              <input type="date" value={dates[t]?.end ?? ''} onChange={(e) => set(t, 'end', e.target.value)} className={input} />
            </label>
          </div>
        ))}
      </div>
      <button onClick={saveTerms} disabled={busy} className="mt-4 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save term dates
      </button>

      <h3 className="mt-6 text-sm font-semibold text-royal-900">Holidays</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="text-xs text-gray-500">
          Name
          <input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Independence Day" className={input} />
        </label>
        <label className="text-xs text-gray-500">
          From
          <input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-gray-500">
          To <span className="text-gray-400">(optional)</span>
          <input type="date" value={hTo} min={hFrom} onChange={(e) => setHTo(e.target.value)} className={input} />
        </label>
        <button onClick={addHoliday} disabled={busy} className="rounded-lg border border-royal-600 px-4 py-2 text-sm font-semibold text-royal-700 hover:bg-royal-50 disabled:opacity-60">
          Add
        </button>
      </div>
      <ul className="mt-3 divide-y divide-gray-100 text-sm">
        {holidays.length === 0 && <li className="py-2 text-gray-500">No holidays added yet.</li>}
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-royal-900">{h.name}</span>
              <span className="ml-2 text-xs text-gray-500">{h.start_date === h.end_date ? fmt(h.start_date) : `${fmt(h.start_date)} – ${fmt(h.end_date)}`}</span>
            </span>
            <button onClick={() => removeHoliday(h.id)} aria-label={`Remove ${h.name}`} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {msg && (
        <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
        </p>
      )}
    </section>
  )
}