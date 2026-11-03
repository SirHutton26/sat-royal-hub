import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarDays, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Field, inputClass } from '@/components/lesson-plan-view'
import { functionErrorMessage, isEarlyYears, type PlanRow } from '@/lib/lesson-plan'
import {
  SCHEME_COLUMNS,
  WEEKDAYS,
  calendarWeek,
  calendarWeekOf,
  schemeWeekOf,
  shortDay,
  subjectKey,
  weekDates,
  type SchemeWeek,
  type Weekday,
} from '@/lib/scheme'
import type { ClassOpt } from '@/lib/use-teacher-classes'

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const MINUTES = [30, 35, 40, 45, 60, 70, 80, 90, 120]

interface TermRow {
  academic_year: string
  term: string
  start_date: string
  end_date: string
}

function defaultYear() {
  const d = new Date()
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}/${start + 1}`
}

export default function WeeklyPlanner({
  role,
  classOpts,
  onGenerated,
}: {
  role: string | undefined
  classOpts: ClassOpt[]
  onGenerated: (plans: PlanRow[], remaining: number | null) => void
}) {
  // ----- school settings: year, term and how far ahead of the government schedule the school is
  const [year, setYear] = useState(defaultYear())
  const [term, setTerm] = useState(TERMS[0])
  const [offset, setOffset] = useState(0)
  const [termRows, setTermRows] = useState<TermRow[]>([])
  const [offsetDraft, setOffsetDraft] = useState('0')
  const [offsetMsg, setOffsetMsg] = useState('')
  const canSetOffset = role === 'admin' || role === 'headteacher'

  useEffect(() => {
    let alive = true
    void (async () => {
      let s = await supabase.from('school_settings').select('current_academic_year, current_term, scheme_week_offset').limit(1).maybeSingle()
      if (s.error) s = await supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle() // before the offset column exists
      const td = await supabase.from('term_dates').select('academic_year, term, start_date, end_date')
      if (!alive) return
      if (s.data?.current_academic_year) setYear(s.data.current_academic_year as string)
      if (s.data?.current_term && TERMS.includes(s.data.current_term as string)) setTerm(s.data.current_term as string)
      const off = Number((s.data as { scheme_week_offset?: number } | null)?.scheme_week_offset ?? 0) || 0
      setOffset(off)
      setOffsetDraft(String(off))
      setTermRows(((td.data ?? []) as TermRow[]).filter((r) => r.start_date && r.end_date))
    })()
    return () => {
      alive = false
    }
  }, [])

  const termRow = termRows.find((r) => r.academic_year === year && r.term === term)

  // ----- the form
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [weeks, setWeeks] = useState<SchemeWeek[] | null>(null)
  const [weekNo, setWeekNo] = useState<number | ''>('')
  const [days, setDays] = useState<Record<Weekday, { on: boolean; minutes: number }>>(
    () => Object.fromEntries(WEEKDAYS.map((d) => [d, { on: false, minutes: 60 }])) as Record<Weekday, { on: boolean; minutes: number }>,
  )
  const [classSize, setClassSize] = useState('')
  const [notes, setNotes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (classOpts.length === 1) {
      setClassId(classOpts[0].id)
      if (classOpts[0].subjects.length === 1) setSubject(classOpts[0].subjects[0])
    }
  }, [classOpts])

  const cls = classOpts.find((c) => c.id === classId)

  // lessons run 30 minutes in the early years, otherwise 60, until the teacher changes a day
  useEffect(() => {
    if (!cls) return
    const m = isEarlyYears(cls.name) ? 30 : 60
    setDays((d) => Object.fromEntries(WEEKDAYS.map((w) => [w, { ...d[w], minutes: d[w].on ? d[w].minutes : m }])) as typeof d)
  }, [cls?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- this subject's weeks of the scheme
  useEffect(() => {
    setWeeks(null)
    setWeekNo('')
    setError('')
    if (!cls || !subject) return
    let alive = true
    void supabase
      .from('scheme_weeks')
      .select(SCHEME_COLUMNS)
      .eq('academic_year', year)
      .eq('term', term)
      .eq('subject_key', subjectKey(subject))
      .ilike('class_name', cls.name)
      .order('week_no')
      .then(({ data, error: err }) => {
        if (alive) setWeeks(err ? [] : ((data ?? []) as SchemeWeek[]))
      })
    return () => {
      alive = false
    }
  }, [cls?.name, subject, year, term]) // eslint-disable-line react-hooks/exhaustive-deps

  // which scheme week the school is on today, and next week
  const suggestion = useMemo(() => {
    if (!termRow) return null
    const cal = calendarWeek(new Date(), termRow.start_date, termRow.end_date)
    if (cal === null) return null
    return { thisWeek: schemeWeekOf(cal, offset), nextWeek: schemeWeekOf(cal + 1, offset) }
  }, [termRow, offset])

  // pick the week to plan: from Thursday on, teachers are preparing for next week
  useEffect(() => {
    if (!weeks || !weeks.length || !suggestion) return
    const preparingNext = [0, 4, 5, 6].includes(new Date().getDay())
    const want = preparingNext ? suggestion.nextWeek : suggestion.thisWeek
    const nos = weeks.map((w) => w.week_no)
    setWeekNo(nos.includes(want) ? want : '')
  }, [weeks, suggestion])

  const week = weeks?.find((w) => w.week_no === weekNo)
  const dates = termRow && week ? weekDates(termRow.start_date, calendarWeekOf(week.week_no, offset)) : null
  const weekLabel = (w: SchemeWeek) => {
    const dts = termRow ? weekDates(termRow.start_date, calendarWeekOf(w.week_no, offset)) : null
    const kind = w.kind === 'lesson' ? '' : w.kind === 'revision' ? ' (revision)' : w.kind === 'exam' ? ' (examination)' : ' (SBA)'
    const topic = w.topic && w.kind === 'lesson' ? w.topic : ''
    return `Week ${w.week_no}${topic ? ` · ${topic}` : ''}${kind}${dts ? ` · ${shortDay(dts.Monday)} to ${shortDay(dts.Friday)}` : ''}`
  }

  const chosenDays = WEEKDAYS.filter((d) => days[d].on)
  const writable = !!week && (week.kind === 'lesson' || week.kind === 'revision')
  const ready = !!cls && !!subject && writable && chosenDays.length > 0

  const setDay = (d: Weekday, patch: Partial<{ on: boolean; minutes: number }>) => setDays((x) => ({ ...x, [d]: { ...x[d], ...patch } }))

  async function generate() {
    if (!cls || !week || !ready) return
    if (!navigator.onLine) return setError('You need internet to write a weekly plan.')
    setGenerating(true)
    setError('')
    const { data, error: err } = await supabase.functions.invoke('generate-weekly-plan', {
      body: {
        schemeWeekId: week.id,
        className: cls.name,
        subject,
        days: chosenDays.map((d) => ({ label: d, date: dates?.[d] ?? null, minutes: days[d].minutes })),
        classSize: classSize ? Number(classSize) : null,
        notes: notes.trim(),
      },
    })
    setGenerating(false)
    if (err) return setError(await functionErrorMessage(err))
    if (data?.error) return setError(String(data.error))
    if (!Array.isArray(data?.plans) || !data.plans.length) return setError('No plan came back. Please try again.')
    onGenerated(data.plans as PlanRow[], typeof data.remaining === 'number' ? data.remaining : null)
  }

  async function saveOffset() {
    setOffsetMsg('')
    const n = Number(offsetDraft)
    const { error: err } = await supabase.rpc('set_scheme_week_offset', { p_weeks: n })
    if (err) return setOffsetMsg(err.message)
    setOffset(n)
    setOffsetMsg('Saved.')
  }

  return (
    <div className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Class">
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSubject('') }} className={inputClass}>
            <option value="">Choose a class...</option>
            {classOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Subject">
          <select value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!cls} className={inputClass}>
            <option value="">Choose a subject...</option>
            {(cls?.subjects ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={`Term (${year})`}>
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={inputClass}>
            {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      {cls && subject && weeks === null && <Loader2 className="h-5 w-5 animate-spin text-royal-600" />}

      {cls && subject && weeks !== null && weeks.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          The scheme of learning for {cls.name} {subject} in {term} is not loaded yet. Please ask the administrator, or use the Single lesson tab.
        </p>
      )}

      {cls && subject && weeks !== null && weeks.length > 0 && (
        <>
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <Field label="Week of the scheme of learning">
              <select value={weekNo} onChange={(e) => setWeekNo(e.target.value ? Number(e.target.value) : '')} className={inputClass}>
                <option value="">Choose a week...</option>
                {weeks.map((w) => <option key={w.id} value={w.week_no}>{weekLabel(w)}</option>)}
              </select>
            </Field>
            {suggestion && (
              <div className="flex flex-wrap gap-2 text-xs">
                {([['This week', suggestion.thisWeek], ['Next week', suggestion.nextWeek]] as const).map(([label, n]) =>
                  weeks.some((w) => w.week_no === n) ? (
                    <button key={label} type="button" onClick={() => setWeekNo(n)} className={`rounded-full border px-3 py-1 font-semibold ${weekNo === n ? 'border-royal-600 bg-royal-600 text-white' : 'border-gray-300 text-royal-900 hover:border-royal-400'}`}>
                      {label}: week {n}
                    </button>
                  ) : null,
                )}
              </div>
            )}
            <p className="text-xs text-gray-500">
              {offset > 0
                ? `Our school is ${offset} week${offset === 1 ? '' : 's'} ahead of the government schedule, so scheme week ${schemeWeekOf(1, offset)} is taught in our first week.`
                : 'The school follows the government schedule week for week.'}
            </p>
            {canSetOffset && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-royal-50 px-3 py-2 text-xs text-royal-900">
                <span className="font-semibold">Weeks ahead of the government schedule:</span>
                <select value={offsetDraft} onChange={(e) => setOffsetDraft(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1" aria-label="Weeks ahead">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button type="button" onClick={() => void saveOffset()} disabled={Number(offsetDraft) === offset} className="rounded-md bg-royal-600 px-3 py-1 font-semibold text-white hover:bg-royal-700 disabled:opacity-50">Save</button>
                {offsetMsg && <span className="text-gray-600">{offsetMsg}</span>}
              </div>
            )}
          </div>

          {week && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-royal-900">
                <CalendarDays className="h-4 w-4 text-royal-600" />
                Scheme week {week.week_no}
                {dates && <span className="font-normal text-gray-500">taught {shortDay(dates.Monday)} to {shortDay(dates.Friday)}</span>}
              </p>
              {week.kind === 'exam' && <p className="mt-2 text-gray-600">This week is for examinations. There is no lesson plan to write.</p>}
              {week.kind === 'sba' && <p className="mt-2 text-gray-600">This week is for SBA activities. There is no lesson plan to write.</p>}
              {week.kind === 'revision' && <p className="mt-2 text-gray-600">Revision week. The plan will revise the topics taught earlier this term.</p>}
              {week.kind === 'lesson' && week.items.length === 0 && (
                <p className="mt-2 text-gray-600">
                  Topic: <b>{week.topic}</b>. The detailed scheme for this week is not loaded yet, so the plan will follow the topic and the NaCCA curriculum.
                </p>
              )}
              {week.kind === 'lesson' &&
                week.items.map((it, i) => (
                  <div key={i} className="mt-3 border-t border-gray-200 pt-3 first:mt-2 first:border-0 first:pt-0">
                    <p className="text-xs text-gray-500">{[it.strand, it.sub_strand].filter(Boolean).join(' › ')}</p>
                    {it.content_standard && <p className="mt-0.5 text-gray-700">{it.content_standard}</p>}
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-800">
                      {it.indicators.map((ind, n) => (
                        <li key={n}>{ind.code && <b className="mr-1">{ind.code}</b>}{ind.text}</li>
                      ))}
                    </ul>
                    {it.resources && <p className="mt-1 text-xs text-gray-500">Resources: {it.resources}</p>}
                  </div>
                ))}
            </div>
          )}

          {writable && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-royal-900">
                Days you teach {subject} this week <span className="font-normal text-gray-500">(one lesson is written for each day)</span>
              </p>
              <div className="space-y-2">
                {WEEKDAYS.map((d) => (
                  <div key={d} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${days[d].on ? 'border-royal-400 bg-royal-50' : 'border-gray-200'}`}>
                    <label className="flex min-w-[9rem] cursor-pointer items-center gap-2 text-sm font-medium text-royal-900">
                      <input type="checkbox" checked={days[d].on} onChange={(e) => setDay(d, { on: e.target.checked })} className="h-4 w-4 accent-royal-600" />
                      {d}
                      {dates && <span className="text-xs font-normal text-gray-500">{shortDay(dates[d])}</span>}
                    </label>
                    <select value={days[d].minutes} onChange={(e) => setDay(d, { minutes: Number(e.target.value) })} disabled={!days[d].on} className="w-32 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-400" aria-label={`${d} lesson time`}>
                      {MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Class size (optional)">
                  <input inputMode="numeric" value={classSize} onChange={(e) => setClassSize(e.target.value.replace(/\D/g, '').slice(0, 3))} className={inputClass} />
                </Field>
                <Field label="Anything the plan should consider? (optional)" wide>
                  <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={inputClass} placeholder="For example: no projector, mixed ability class" />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={() => void generate()}
        disabled={!ready || generating}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-royal-600 py-3 text-sm font-bold text-white hover:bg-royal-700 disabled:opacity-50"
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generating
          ? 'Writing your weekly plan... this can take up to a minute'
          : chosenDays.length > 1
            ? `Write my plan for ${chosenDays.length} lessons`
            : 'Write my weekly plan'}
      </button>
      {ready && !generating && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <CheckCircle2 className="h-3.5 w-3.5" /> Counts as one of your daily plans.
        </p>
      )}
    </div>
  )
}
