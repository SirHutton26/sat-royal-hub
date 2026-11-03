import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileText, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { Field, PlanView, inputClass } from '@/components/lesson-plan-view'
import { WeekView } from '@/components/week-view'
import WeeklyPlanner from '@/pages/teacher/weekly-planner'
import { useTeacherClasses } from '@/lib/use-teacher-classes'
import { subjectKey } from '@/lib/scheme'
import {
  PLAN_COLUMNS,
  PLAN_COLUMNS_WEEK,
  fmtDate,
  functionErrorMessage,
  isEarlyYears,
  type PlanRow,
} from '@/lib/lesson-plan'

const DURATIONS = [30, 35, 40, 45, 60, 70, 80, 90, 120]
const MAX_INDICATORS = 5

interface CurRow {
  id: string
  strand: string
  sub_strand: string
  content_standard_code: string | null
  content_standard: string
  indicator_code: string | null
  indicator: string
  sort_order: number
}
const CUR_COLUMNS = 'id, strand, sub_strand, content_standard_code, content_standard, indicator_code, indicator, sort_order'

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const unique = <T,>(xs: T[]) => [...new Set(xs)]
const standardKey = (r: CurRow) => `${r.content_standard_code ?? ''}|${r.content_standard}`
const standardLabel = (r: CurRow) => `${r.content_standard_code ? `${r.content_standard_code} ` : ''}${r.content_standard}`

/* =============================================================== page */

export default function TeacherLessonPlans() {
  const { profile } = useAuth()
  const teacherName = profile?.full_name || profile?.email || ''
  const profileId = profile?.id

  const [tab, setTab] = useState<'weekly' | 'new' | 'saved'>('weekly')
  const [open, setOpen] = useState<PlanRow | null>(null)
  const [openWeek, setOpenWeek] = useState<PlanRow[] | null>(null)
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [plansLoading, setPlansLoading] = useState(true)

  // what the teacher teaches
  const { classOpts, loaded: optsLoaded } = useTeacherClasses(profileId)

  // the form
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [cur, setCur] = useState<CurRow[] | null>(null)
  const [strand, setStrand] = useState('')
  const [subStrand, setSubStrand] = useState('')
  const [standard, setStandard] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [ownTopic, setOwnTopic] = useState(false)
  const [mStrand, setMStrand] = useState('')
  const [mStandard, setMStandard] = useState('')
  const [mIndicator, setMIndicator] = useState('')
  const [duration, setDuration] = useState(60)
  const [durationTouched, setDurationTouched] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [classSize, setClassSize] = useState('')
  const [notes, setNotes] = useState('')

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (classOpts.length === 1) {
      setClassId(classOpts[0].id)
      if (classOpts[0].subjects.length === 1) setSubject(classOpts[0].subjects[0])
    }
  }, [classOpts])

  const loadPlans = useCallback(async () => {
    if (!profileId) return
    const read = (cols: string) => supabase.from('lesson_plans').select(cols).eq('teacher_id', profileId).order('created_at', { ascending: false }).limit(200)
    let res = await read(PLAN_COLUMNS_WEEK)
    if (res.error) res = await read(PLAN_COLUMNS) // the weekly columns do not exist yet
    setPlans((res.data ?? []) as unknown as PlanRow[])
    setPlansLoading(false)
  }, [profileId])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const cls = classOpts.find((c) => c.id === classId)

  /* ----- the curriculum for the chosen class and subject ----- */
  useEffect(() => {
    setCur(null)
    setStrand('')
    setSubStrand('')
    setStandard('')
    setPicked([])
    setOwnTopic(false)
    if (!cls || !subject) return
    let alive = true
    void (async () => {
      const base = () => supabase.from('curriculum_items').select(CUR_COLUMNS).ilike('class_name', cls.name)
      // the curriculum and the school can name a subject differently (RME / Religious & Moral Education), so look it up by its key
      let res = await base().eq('subject_key', subjectKey(subject)).order('sort_order').limit(2000)
      if (res.error) res = await base().ilike('subject', subject).order('sort_order').limit(2000) // before the subject_key column exists
      if (alive) setCur(res.error ? [] : ((res.data ?? []) as unknown as CurRow[]))
    })()
    return () => {
      alive = false
    }
  }, [cls?.name, subject]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!durationTouched && cls) setDuration(isEarlyYears(cls.name) ? 30 : 60)
  }, [cls, durationTouched])

  const manual = cur !== null && (cur.length === 0 || ownTopic)
  const rows = cur ?? []
  const strands = useMemo(() => unique(rows.map((r) => r.strand)), [rows])
  const effStrand = strands.includes(strand) ? strand : strands.length === 1 ? strands[0] : ''
  const subStrands = useMemo(() => unique(rows.filter((r) => r.strand === effStrand).map((r) => r.sub_strand)), [rows, effStrand])
  const effSub = subStrands.includes(subStrand) ? subStrand : subStrands.length === 1 ? subStrands[0] : ''
  const standards = useMemo(
    () => unique(rows.filter((r) => r.strand === effStrand && r.sub_strand === effSub).map(standardKey)),
    [rows, effStrand, effSub],
  )
  const effStd = standards.includes(standard) ? standard : standards.length === 1 ? standards[0] : ''
  const indicators = useMemo(
    () => rows.filter((r) => r.strand === effStrand && r.sub_strand === effSub && standardKey(r) === effStd),
    [rows, effStrand, effSub, effStd],
  )
  const pickedHere = picked.filter((id) => indicators.some((r) => r.id === id))

  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_INDICATORS ? [...p, id] : p))
  }

  const ready =
    !!cls && !!subject && cur !== null && (manual ? !!(mStrand.trim() && mIndicator.trim()) : pickedHere.length > 0)

  async function generate() {
    if (!cls || !ready) return
    if (!navigator.onLine) return setError('You need internet to write a lesson plan.')
    setGenerating(true)
    setError('')
    const body = {
      className: cls.name,
      subject,
      durationMinutes: duration,
      classSize: classSize ? Number(classSize) : null,
      lessonDate: date || null,
      notes: notes.trim(),
      ...(manual
        ? { manual: { strand: mStrand.trim(), subStrand: '', contentStandard: mStandard.trim(), indicator: mIndicator.trim() } }
        : { curriculumIds: pickedHere }),
    }
    const { data, error: err } = await supabase.functions.invoke('generate-lesson-plan', { body })
    setGenerating(false)
    if (err) return setError(await functionErrorMessage(err))
    if (data?.error) return setError(String(data.error))
    if (!data?.plan) return setError('No plan came back. Please try again.')
    setRemaining(typeof data.remaining === 'number' ? data.remaining : null)
    setOpen(data.plan as PlanRow)
    void loadPlans()
  }

  // saved plans: the lessons of one week are shown as one entry
  const entries = useMemo(() => {
    const out: { key: string; plans: PlanRow[] }[] = []
    const groups = new Map<string, { key: string; plans: PlanRow[] }>()
    for (const p of plans) {
      if (p.week_group) {
        let g = groups.get(p.week_group)
        if (!g) {
          g = { key: p.week_group, plans: [] }
          groups.set(p.week_group, g)
          out.push(g)
        }
        g.plans.push(p)
      } else out.push({ key: p.id, plans: [p] })
    }
    out.forEach((e) => e.plans.sort((a, b) => (a.lesson_date ?? a.created_at).localeCompare(b.lesson_date ?? b.created_at)))
    return out
  }, [plans])

  const replacePlan = (r: PlanRow) => {
    setPlans((ps) => ps.map((x) => (x.id === r.id ? r : x)))
    setOpenWeek((w) => (w ? w.map((x) => (x.id === r.id ? r : x)) : w))
  }
  const removePlan = (id: string) => {
    setPlans((ps) => ps.filter((x) => x.id !== id))
    setOpenWeek((w) => {
      const left = w ? w.filter((x) => x.id !== id) : w
      return left && left.length ? left : null
    })
    setTab('saved')
  }

  /* ----- viewing a week ----- */
  if (openWeek) {
    return (
      <div className="mx-auto max-w-4xl">
        <WeekView plans={openWeek} teacherName={teacherName} onBack={() => setOpenWeek(null)} onSaved={replacePlan} onDeleted={removePlan} />
        {remaining !== null && (
          <p className="mt-3 text-xs text-gray-500">
            You can write {remaining} more lesson plan{remaining === 1 ? '' : 's'} today.
          </p>
        )}
      </div>
    )
  }

  /* ----- viewing one plan ----- */
  if (open) {
    return (
      <div className="mx-auto max-w-4xl">
        <PlanView
          row={open}
          teacherName={teacherName}
          onBack={() => setOpen(null)}
          onSaved={(r) => {
            setOpen(r)
            setPlans((ps) => ps.map((x) => (x.id === r.id ? r : x)))
          }}
          onDeleted={(id) => {
            setPlans((ps) => ps.filter((x) => x.id !== id))
            setOpen(null)
            setTab('saved')
          }}
        />
        {remaining !== null && (
          <p className="mt-3 text-xs text-gray-500">
            You can write {remaining} more lesson plan{remaining === 1 ? '' : 's'} today.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-royal-900">
        <Sparkles className="h-6 w-6 text-gold-500" /> Lesson Plans
      </h1>
      <p className="mt-1 text-sm text-gray-500">Write your weekly plan from the scheme of learning, or a single lesson from the curriculum. Every plan can be edited and printed.</p>

      <div className="mt-4 inline-flex rounded-lg bg-gray-100 p-1" role="tablist">
        {([['weekly', 'Weekly plan'], ['new', 'Single lesson'], ['saved', `My plans${entries.length ? ` (${entries.length})` : ''}`]] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === k ? 'bg-white text-royal-900 shadow-sm' : 'text-gray-500 hover:text-royal-900'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'saved' ? (
        <div className="mt-4 space-y-2">
          {plansLoading ? (
            <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-royal-600" />
          ) : entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">
              No lesson plans yet. Make your first one in the Weekly plan tab.
            </p>
          ) : (
            entries.map((e) => {
              const r = e.plans[0]
              const isWeek = !!r.week_group
              return (
                <button
                  key={e.key}
                  onClick={() => (isWeek ? setOpenWeek(e.plans) : setOpen(r))}
                  className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-royal-300 hover:shadow-md"
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isWeek ? 'bg-gold-400 text-royal-900' : 'bg-royal-50 text-royal-600'}`}>
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-royal-900">
                      {isWeek ? `Week ${r.week_no ?? ''}${r.sub_strand ? ` · ${r.sub_strand}` : ''}` : r.title}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {r.class_name} · {r.subject}
                      {isWeek ? ` · ${r.term ?? ''} · ${e.plans.length} lesson${e.plans.length === 1 ? '' : 's'}` : r.sub_strand ? ` · ${r.sub_strand}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-gray-400">{fmtDate(r.lesson_date || r.created_at)}</p>
                </button>
              )
            })
          )}
        </div>
      ) : !optsLoaded ? (
        <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-royal-600" />
      ) : classOpts.length === 0 ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
          You have not been given a class or subject yet, so there is nothing to plan. Please ask the administrator.
        </p>
      ) : tab === 'weekly' ? (
        <WeeklyPlanner
          role={profile?.role}
          classOpts={classOpts}
          onGenerated={(newPlans, rem) => {
            setRemaining(rem)
            setOpenWeek(newPlans)
            void loadPlans()
          }}
        />
      ) : (
        <div className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          {cls && subject && cur === null && <Loader2 className="h-5 w-5 animate-spin text-royal-600" />}

          {cls && subject && cur !== null && !manual && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Strand">
                  <select value={effStrand} onChange={(e) => { setStrand(e.target.value); setSubStrand(''); setStandard(''); setPicked([]) }} className={inputClass}>
                    <option value="">Choose a strand...</option>
                    {strands.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Sub-strand">
                  <select value={effSub} onChange={(e) => { setSubStrand(e.target.value); setStandard(''); setPicked([]) }} disabled={!effStrand} className={inputClass}>
                    <option value="">Choose a sub-strand...</option>
                    {subStrands.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Content standard" wide>
                  <select value={effStd} onChange={(e) => { setStandard(e.target.value); setPicked([]) }} disabled={!effSub} className={inputClass}>
                    <option value="">Choose a content standard...</option>
                    {standards.map((k) => {
                      const r = rows.find((x) => standardKey(x) === k)!
                      return <option key={k} value={k}>{standardLabel(r)}</option>
                    })}
                  </select>
                </Field>
              </div>
              {effStd && (
                <div>
                  <p className="text-sm font-medium text-royal-900">
                    Indicators for this lesson <span className="font-normal text-gray-500">(choose 1 to {MAX_INDICATORS})</span>
                  </p>
                  <div className="mt-2 space-y-2">
                    {indicators.map((r) => {
                      const on = pickedHere.includes(r.id)
                      return (
                        <label key={r.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm ${on ? 'border-royal-400 bg-royal-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <input type="checkbox" checked={on} onChange={() => togglePick(r.id)} className="mt-0.5 h-4 w-4 accent-royal-600" />
                          <span>{r.indicator_code && <b className="mr-1">{r.indicator_code}</b>}{r.indicator}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              <button type="button" onClick={() => setOwnTopic(true)} className="text-xs font-semibold text-royal-600 hover:underline">
                Cannot find it? Type my own topic instead
              </button>
            </div>
          )}

          {cls && subject && manual && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              {cur!.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  The curriculum for {cls.name} {subject} is not loaded yet. Type your topic and the AI will plan from it.
                </p>
              ) : (
                <button type="button" onClick={() => setOwnTopic(false)} className="text-xs font-semibold text-royal-600 hover:underline">
                  Use the curriculum list instead
                </button>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Strand or topic" wide>
                  <input value={mStrand} onChange={(e) => setMStrand(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. Input and output devices" />
                </Field>
                <Field label="Content standard (if you know it)" wide>
                  <input value={mStandard} onChange={(e) => setMStandard(e.target.value)} maxLength={400} className={inputClass} />
                </Field>
                <Field label="What should learners be able to do by the end of the lesson?" wide>
                  <textarea rows={2} value={mIndicator} onChange={(e) => setMIndicator(e.target.value)} maxLength={500} className={inputClass} placeholder="e.g. Name five input devices and say what each one does" />
                </Field>
              </div>
            </div>
          )}

          {cls && subject && cur !== null && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Lesson time">
                  <select value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setDurationTouched(true) }} className={inputClass}>
                    {(DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)).map((d) => <option key={d} value={d}>{d} minutes</option>)}
                  </select>
                </Field>
                <Field label="Lesson date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Class size (optional)">
                  <input inputMode="numeric" value={classSize} onChange={(e) => setClassSize(e.target.value.replace(/\D/g, '').slice(0, 3))} className={inputClass} />
                </Field>
              </div>
              <Field label="Anything the plan should consider? (optional)" hint="For example: no projector, mixed ability class, limited textbooks.">
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={inputClass} />
              </Field>
            </div>
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
            {generating ? 'Writing your lesson plan... this can take up to a minute' : 'Write my lesson plan'}
          </button>
        </div>
      )}
    </div>
  )
}
