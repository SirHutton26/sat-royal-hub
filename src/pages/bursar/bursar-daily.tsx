import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Coins, Loader2, Printer, Send, Soup } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { isWeekday, lastWeekday, localISO, parseISODate } from '@/lib/attendance'
import { money } from '@/components/fees/fee-utils'

/* ---------- types & helpers ---------- */

interface ClassRow {
  id: string
  name: string
  level_group: string | null
}

interface Rate {
  school: number
  cls: number
}

interface SavedCollection {
  class_id: string
  students_present: number
  students_paying: number
  school_fee_total: number
  class_fee_total: number
}

interface WeekCollection {
  date: string
  school_fee_total: number
  class_fee_total: number
}

interface Remittance {
  amount: number
  note: string | null
  submitted_at: string
}

const LEVEL_ORDER = ['creche', 'nursery', 'kg', 'lower_primary', 'upper_primary', 'jhs']

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const round2 = (n: number) => Math.round(n * 100) / 100

function mondayOf(iso: string): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localISO(d)
}

function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return localISO(d)
}

const dayLabel = (iso: string) =>
  parseISODate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const longDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/* ---------- page ---------- */

export default function BursarDaily() {
  const { profile } = useAuth()
  const [date, setDate] = useState(lastWeekday())
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [rates, setRates] = useState<Record<string, Rate>>({})
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // the selected day
  const [present, setPresent] = useState<Record<string, number>>({})
  const [paying, setPaying] = useState<Record<string, string>>({})
  const [hasSaved, setHasSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savingDay, setSavingDay] = useState(false)

  // feeding
  const [feeding, setFeeding] = useState('')
  const [feedingNote, setFeedingNote] = useState('')
  const [feedingSaved, setFeedingSaved] = useState(false)
  const [savingFeeding, setSavingFeeding] = useState(false)

  // the week the selected day falls in
  const weekStart = mondayOf(date)
  const [weekRows, setWeekRows] = useState<WeekCollection[]>([])
  const [weekFeeding, setWeekFeeding] = useState<Record<string, number>>({})
  const [remittance, setRemittance] = useState<Remittance | null>(null)
  const [remitNote, setRemitNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tick, setTick] = useState(0)

  function showToast(type: 'ok' | 'error', text: string) {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 3500)
  }

  /* ----- classes and rates (once) ----- */
  useEffect(() => {
    async function init() {
      const [cls, rt] = await Promise.all([
        supabase.from('classes').select('id, name, level_group'),
        supabase.from('daily_fee_rates').select('class_id, school_fee, class_fee'),
      ])
      if (cls.error) showToast('error', cls.error.message)
      if (rt.error) showToast('error', `Could not load daily rates: ${rt.error.message}`)
      const sorted = ((cls.data ?? []) as ClassRow[]).sort(
        (a, b) =>
          LEVEL_ORDER.indexOf(a.level_group ?? '') - LEVEL_ORDER.indexOf(b.level_group ?? '') ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      setClasses(sorted)
      const map: Record<string, Rate> = {}
      for (const r of rt.data ?? []) map[r.class_id] = { school: Number(r.school_fee), cls: Number(r.class_fee) }
      setRates(map)
    }
    void init()
  }, [])

  /* ----- the selected day ----- */
  useEffect(() => {
    let cancelled = false
    async function loadDay() {
      setLoading(true)
      const [counts, saved, feed] = await Promise.all([
        supabase.rpc('daily_present_counts', { p_date: date }),
        supabase
          .from('daily_collections')
          .select('class_id, students_present, students_paying, school_fee_total, class_fee_total')
          .eq('date', date),
        supabase.from('daily_feeding').select('amount, note').eq('date', date).maybeSingle(),
      ])
      if (cancelled) return
      if (counts.error) showToast('error', `Could not read attendance: ${counts.error.message}`)
      if (saved.error) showToast('error', saved.error.message)

      const presentMap: Record<string, number> = {}
      for (const r of (counts.data ?? []) as { class_id: string; present: number }[]) presentMap[r.class_id] = Number(r.present)
      setPresent(presentMap)

      const savedRows = (saved.data ?? []) as SavedCollection[]
      const savedMap = new Map(savedRows.map((r) => [r.class_id, r]))
      const next: Record<string, string> = {}
      for (const c of classes) {
        const s = savedMap.get(c.id)
        next[c.id] = String(s ? s.students_paying : (presentMap[c.id] ?? 0))
      }
      setPaying(next)
      setHasSaved(savedRows.length > 0)
      setDirty(false)

      setFeeding(feed.data ? String(Number(feed.data.amount)) : '')
      setFeedingNote(feed.data?.note ?? '')
      setFeedingSaved(!!feed.data)
      setLoading(false)
    }
    void loadDay()
    return () => {
      cancelled = true
    }
  }, [date, classes])

  /* ----- the week ----- */
  useEffect(() => {
    let cancelled = false
    async function loadWeek() {
      const end = addDays(weekStart, 4)
      const [col, feed, rem] = await Promise.all([
        supabase.from('daily_collections').select('date, school_fee_total, class_fee_total').gte('date', weekStart).lte('date', end),
        supabase.from('daily_feeding').select('date, amount').gte('date', weekStart).lte('date', end),
        supabase.from('weekly_class_fee_remittances').select('amount, note, submitted_at').eq('week_start', weekStart).maybeSingle(),
      ])
      if (cancelled) return
      setWeekRows(((col.data ?? []) as WeekCollection[]).map((r) => ({ ...r, school_fee_total: Number(r.school_fee_total), class_fee_total: Number(r.class_fee_total) })))
      const fm: Record<string, number> = {}
      for (const f of feed.data ?? []) fm[f.date] = Number(f.amount)
      setWeekFeeding(fm)
      setRemittance(rem.data ? { ...(rem.data as Remittance), amount: Number(rem.data.amount) } : null)
      setRemitNote(rem.data?.note ?? '')
    }
    void loadWeek()
    return () => {
      cancelled = true
    }
  }, [weekStart, tick])

  /* ----- derived ----- */
  const billable = useMemo(() => classes.filter((c) => (rates[c.id]?.school ?? 0) > 0 || (rates[c.id]?.cls ?? 0) > 0), [classes, rates])

  const countOf = (id: string) => {
    const n = Math.floor(Number(paying[id]))
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const dayTotals = useMemo(() => {
    let school = 0
    let cls = 0
    for (const c of billable) {
      const n = Math.max(0, Math.floor(Number(paying[c.id])) || 0)
      school += n * (rates[c.id]?.school ?? 0)
      cls += n * (rates[c.id]?.cls ?? 0)
    }
    return { school: round2(school), cls: round2(cls) }
  }, [billable, paying, rates])

  const noAttendance = !hasSaved && billable.length > 0 && billable.every((c) => (present[c.id] ?? 0) === 0)

  const weekDays = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i))
  const weekByDay = weekDays.map((d) => {
    const rows = weekRows.filter((r) => r.date === d)
    const school = rows.reduce((s, r) => s + r.school_fee_total, 0)
    const cls = rows.reduce((s, r) => s + r.class_fee_total, 0)
    const feed = weekFeeding[d] ?? 0
    return { date: d, school: round2(school), cls: round2(cls), feed, total: round2(school + cls + feed) }
  })
  const weekTotals = weekByDay.reduce(
    (t, d) => ({ school: t.school + d.school, cls: t.cls + d.cls, feed: t.feed + d.feed, total: t.total + d.total }),
    { school: 0, cls: 0, feed: 0, total: 0 },
  )
  const weekClassFees = round2(weekTotals.cls)
  const friday = addDays(weekStart, 4)
  const todayStr = localISO()
  const weekOver = todayStr >= friday
  const changedSinceSubmit = !!remittance && Math.abs(remittance.amount - weekClassFees) > 0.004

  /* ----- actions ----- */
  async function saveDay() {
    if (!isWeekday(date)) return showToast('error', 'Collections are only recorded Monday to Friday.')
    if (billable.length === 0) return showToast('error', 'No daily rates are set yet. Ask the administrator to set them.')
    setSavingDay(true)
    const rows = billable.map((c) => {
      const n = countOf(c.id)
      const r = rates[c.id]
      return {
        date,
        class_id: c.id,
        students_present: present[c.id] ?? 0,
        students_paying: n,
        school_fee_rate: r.school,
        class_fee_rate: r.cls,
        school_fee_total: round2(n * r.school),
        class_fee_total: round2(n * r.cls),
        recorded_by: profile?.id,
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase.from('daily_collections').upsert(rows, { onConflict: 'date,class_id' })
    setSavingDay(false)
    if (error) return showToast('error', error.message)
    setHasSaved(true)
    setDirty(false)
    setTick((t) => t + 1)
    showToast('ok', `Collections for ${dayLabel(date)} saved`)
  }

  async function saveFeeding() {
    const amount = Number(feeding)
    if (feeding === '' || Number.isNaN(amount) || amount < 0) return showToast('error', 'Enter the feeding fee collected (0 or more).')
    if (!isWeekday(date)) return showToast('error', 'Collections are only recorded Monday to Friday.')
    setSavingFeeding(true)
    const { error } = await supabase.from('daily_feeding').upsert(
      { date, amount: round2(amount), note: feedingNote.trim() || null, recorded_by: profile?.id, updated_at: new Date().toISOString() },
      { onConflict: 'date' },
    )
    setSavingFeeding(false)
    if (error) return showToast('error', error.message)
    setFeedingSaved(true)
    setTick((t) => t + 1)
    showToast('ok', `Feeding fee for ${dayLabel(date)} saved`)
  }

  async function submitToHeadteacher() {
    setSubmitting(true)
    const { error } = await supabase.from('weekly_class_fee_remittances').upsert(
      { week_start: weekStart, amount: weekClassFees, note: remitNote.trim() || null, submitted_at: new Date().toISOString(), submitted_by: profile?.id },
      { onConflict: 'week_start' },
    )
    setSubmitting(false)
    if (error) return showToast('error', error.message)
    setTick((t) => t + 1)
    showToast('ok', 'Marked as submitted to the headteacher')
  }

  function printSlip() {
    const w = window.open('', '_blank')
    if (!w) return
    const rowsHtml = weekByDay
      .map((d) => `<tr><td>${dayLabel(d.date)}</td><td style="text-align:right">${money(d.cls)}</td></tr>`)
      .join('')
    w.document.write(`<html><head><title>Weekly class fees</title>
      <style>body{font-family:sans-serif;padding:40px;max-width:560px;margin:auto}h1{font-size:20px;margin:0}p{color:#4b5563}
      table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left}
      .total td{font-weight:bold;border-top:2px solid #111}.sig{margin-top:56px;display:flex;justify-content:space-between}
      .sig div{border-top:1px solid #111;width:40%;padding-top:4px;font-size:12px}</style></head><body>
      <h1>SAT ROYAL BASIC SCHOOL</h1><p>Daily class fees handed to the headteacher<br/>Week of ${dayLabel(weekStart)} to ${dayLabel(friday)}</p>
      <table><tr><th>Day</th><th style="text-align:right">Class fees</th></tr>${rowsHtml}
      <tr class="total"><td>Total</td><td style="text-align:right">${money(weekClassFees)}</td></tr></table>
      <div class="sig"><div>Bursar</div><div>Headteacher</div></div></body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
      w.close()
    }, 400)
  }

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Daily Collections</h1>
          <p className="mt-1 text-sm text-gray-500">
            School fees, class fees and feeding fees collected each school day, Monday to Friday.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Date</label>
          <input
            type="date"
            value={date}
            max={todayStr}
            onChange={(e) => e.target.value && setDate(lastWeekday(e.target.value))}
            className={`${inputClass} mt-1 w-44`}
          />
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold text-royal-900">{longDate(date)}</p>

      {/* Pupils paying today */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">School fees and class fees</h2>
              <p className="text-xs text-gray-500">Pupils present come from the teachers&apos; registers. Change a number if it differs.</p>
            </div>
          </div>
          {hasSaved && !dirty && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {dirty && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Unsaved changes</span>}
        </div>

        {noAttendance && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            No attendance has been marked for this day yet, so counts start at 0. Type the number of pupils who paid in each class.
          </p>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-royal-600 text-white">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Class</th>
                <th className="px-3 py-2.5 text-right font-semibold">Present</th>
                <th className="px-3 py-2.5 text-right font-semibold">Paying</th>
                <th className="px-3 py-2.5 text-right font-semibold">School fee</th>
                <th className="px-3 py-2.5 text-right font-semibold">Class fee</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : billable.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    No daily rates have been set yet. Ask the administrator to set them under Fees → Daily rates.
                  </td>
                </tr>
              ) : (
                billable.map((c) => {
                  const r = rates[c.id]
                  const n = countOf(c.id)
                  return (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-royal-900">{c.name}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{present[c.id] ?? 0}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={paying[c.id] ?? ''}
                          onChange={(e) => {
                            setPaying((p) => ({ ...p, [c.id]: e.target.value }))
                            setDirty(true)
                          }}
                          aria-label={`Pupils paying in ${c.name}`}
                          className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {r.school > 0 ? money(n * r.school) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {r.cls > 0 ? money(n * r.cls) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {!loading && billable.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-royal-900">
                  <td className="px-3 py-3" colSpan={3}>
                    Total for the day
                  </td>
                  <td className="px-3 py-3 text-right">{money(dayTotals.school)}</td>
                  <td className="px-3 py-3 text-right">{money(dayTotals.cls)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void saveDay()}
            disabled={savingDay || loading || billable.length === 0}
            className="flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700 disabled:opacity-60"
          >
            {savingDay && <Loader2 className="h-4 w-4 animate-spin" />}
            {hasSaved ? 'Update collections' : 'Save collections'}
          </button>
        </div>
      </div>

      {/* Feeding */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-400/20 text-gold-500">
              <Soup className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Feeding fee</h2>
              <p className="text-xs text-gray-500">Total feeding fee collected on {dayLabel(date)}.</p>
            </div>
          </div>
          {feedingSaved && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Recorded
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500">Amount collected (GH₵)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={feeding}
              onChange={(e) => setFeeding(e.target.value)}
              placeholder="0.00"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500">Note (optional)</label>
            <input value={feedingNote} onChange={(e) => setFeedingNote(e.target.value)} className={`${inputClass} mt-1`} />
          </div>
          <button
            onClick={() => void saveFeeding()}
            disabled={savingFeeding}
            className="flex items-center justify-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700 disabled:opacity-60"
          >
            {savingFeeding && <Loader2 className="h-4 w-4 animate-spin" />}
            {feedingSaved ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      {/* Week summary */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm md:p-6">
        <h2 className="text-base font-bold text-royal-900">This week</h2>
        <p className="text-xs text-gray-500">
          {dayLabel(weekStart)} to {dayLabel(friday)}
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2.5">Day</th>
                <th className="px-3 py-2.5 text-right">School fees</th>
                <th className="px-3 py-2.5 text-right">Class fees</th>
                <th className="px-3 py-2.5 text-right">Feeding</th>
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {weekByDay.map((d) => (
                <tr
                  key={d.date}
                  onClick={() => d.date <= todayStr && setDate(d.date)}
                  className={`border-t border-gray-100 ${d.date <= todayStr ? 'cursor-pointer hover:bg-royal-50/60' : 'text-gray-300'} ${d.date === date ? 'bg-royal-50/60' : ''}`}
                >
                  <td className="px-3 py-2 font-medium">{dayLabel(d.date)}</td>
                  <td className="px-3 py-2 text-right">{money(d.school)}</td>
                  <td className="px-3 py-2 text-right">{money(d.cls)}</td>
                  <td className="px-3 py-2 text-right">{money(d.feed)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{money(d.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-royal-900">
                <td className="px-3 py-3">Week total</td>
                <td className="px-3 py-3 text-right">{money(weekTotals.school)}</td>
                <td className="px-3 py-3 text-right">{money(weekTotals.cls)}</td>
                <td className="px-3 py-3 text-right">{money(weekTotals.feed)}</td>
                <td className="px-3 py-3 text-right">{money(weekTotals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Friday hand-over */}
        <div className="mt-5 rounded-xl border border-gold-400/50 bg-gold-400/10 p-4">
          <p className="text-sm font-semibold text-royal-900">Class fees for the headteacher</p>
          <p className="mt-1 text-2xl font-bold text-royal-900">{money(weekClassFees)}</p>
          <p className="mt-1 text-xs text-gray-600">Submitted every Friday for the week&apos;s class fees (GH₵1 per pupil per day).</p>

          {remittance ? (
            <div className="mt-3 space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Submitted {money(remittance.amount)} on{' '}
                {new Date(remittance.submitted_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              {changedSinceSubmit && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  The week&apos;s class fees changed after you submitted ({money(remittance.amount)} then, {money(weekClassFees)} now). Submit again to update the record.
                </p>
              )}
            </div>
          ) : (
            !weekOver && (
              <p className="mt-3 text-xs text-amber-700">The week isn&apos;t over yet; this amount will grow until Friday.</p>
            )
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="block text-xs font-medium text-gray-500">Note (optional)</label>
              <input value={remitNote} onChange={(e) => setRemitNote(e.target.value)} className={`${inputClass} mt-1`} />
            </div>
            <button
              onClick={printSlip}
              className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
            >
              <Printer className="h-4 w-4" /> Print slip
            </button>
            <button
              onClick={() => void submitToHeadteacher()}
              disabled={submitting || weekClassFees <= 0 || (!!remittance && !changedSinceSubmit && remitNote.trim() === (remittance.note ?? ''))}
              className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {remittance ? 'Update submission' : 'Mark as submitted'}
            </button>
          </div>
        </div>
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
