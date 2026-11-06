import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowLeft, BookOpen, CheckCircle2, AlertCircle, Cloud, CloudOff, GraduationCap, Loader2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

export interface CassSessionInfo {
  id: string
  academic_year: string
  start_date: string
  end_date: string
}

/** A Basic 9 class the teacher teaches subjects in */
export interface CassContext {
  classId: string
  className: string
  subjects: string[]
}

interface Student {
  id: string
  full_name: string
  admission_number: string
}

type Pair = { y1: string; y2: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type RowFilter = 'all' | 'pending' | 'entered'

const AUTOSAVE_DELAY = 700
const RETRY_DELAY = 5000

const has = (v: string | undefined) => v !== undefined && v !== ''

function scoreInputClasses(score: string | undefined) {
  const neutral = 'border-gray-200 bg-white text-royal-900 focus:border-royal-500 focus:ring-royal-100'
  if (!has(score)) return neutral
  const num = Number(score)
  if (isNaN(num)) return neutral
  if (num < 50) return 'border-red-300 bg-red-50 text-red-700 focus:border-red-400 focus:ring-red-100'
  if (num < 80) return 'border-amber-300 bg-amber-50 text-amber-700 focus:border-amber-400 focus:ring-amber-100'
  return 'border-green-300 bg-green-50 text-green-700 focus:border-green-400 focus:ring-green-100'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-royal-50 px-3 py-1 text-xs font-semibold text-royal-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...
      </span>
    )
  if (state === 'error')
    return (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        <CloudOff className="h-3.5 w-3.5" /> Not saved · Tap to retry
      </button>
    )
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> All changes saved
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
      <Cloud className="h-3.5 w-3.5" /> Auto-save on
    </span>
  )
}

export default function TeacherCassEntry({
  session,
  contexts: rawContexts,
  onBack,
}: {
  session: CassSessionInfo
  contexts: CassContext[]
  onBack: () => void
}) {
  const { profile } = useAuth()
  // Only subjects that still exist on the admin Subjects page (old/renamed assignments are ignored)
  const [validSubjects, setValidSubjects] = useState<Set<string> | null>(null)
  useEffect(() => {
    supabase
      .from('subjects')
      .select('name')
      .eq('level_group', 'jhs')
      .then(({ data }) => setValidSubjects(new Set(((data ?? []) as { name: string }[]).map((s) => s.name))))
  }, [])
  const contexts = useMemo(
    () =>
      rawContexts
        .map((c) => ({ ...c, subjects: validSubjects ? c.subjects.filter((s) => validSubjects.has(s)) : c.subjects }))
        .filter((c) => c.subjects.length > 0),
    [rawContexts, validSubjects],
  )
  const [view, setView] = useState<'pick' | 'scores'>('pick')
  const [classId, setClassId] = useState(contexts[0]?.classId ?? '')
  const [subject, setSubject] = useState(contexts[0]?.subjects[0] ?? '')
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, Pair>>({})
  const [opening, setOpening] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const activeContext = contexts.find((c) => c.classId === classId) ?? null

  // keep the selection valid once the current subject list has loaded
  useEffect(() => {
    const ctx = contexts.find((c) => c.classId === classId) ?? contexts[0]
    if (!ctx) return
    if (ctx.classId !== classId) setClassId(ctx.classId)
    if (!ctx.subjects.includes(subject)) setSubject(ctx.subjects[0] ?? '')
  }, [contexts, classId, subject])

  /* ---------------- auto-save ---------------- */

  const editRef = useRef<{ classId: string; subject: string; profileId: string } | null>(null)
  const dirtyRef = useRef<Map<string, Pair>>(new Map()) // studentId -> latest values
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushingRef = useRef<Promise<boolean> | null>(null)

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    while (flushingRef.current) await flushingRef.current
    if (dirtyRef.current.size === 0) return true

    const run = (async (): Promise<boolean> => {
      const ctx = editRef.current
      if (!ctx) return false
      const snapshot = new Map(dirtyRef.current)
      setSaveState('saving')

      try {
        const upserts: {
          cass_session_id: string
          class_id: string
          subject: string
          student_id: string
          year1_score: number | null
          year2_score: number | null
          recorded_by: string
        }[] = []
        const cleared: string[] = []
        snapshot.forEach((v, studentId) => {
          if (!has(v.y1) && !has(v.y2)) cleared.push(studentId)
          else
            upserts.push({
              cass_session_id: session.id,
              class_id: ctx.classId,
              subject: ctx.subject,
              student_id: studentId,
              year1_score: has(v.y1) ? Number(v.y1) : null,
              year2_score: has(v.y2) ? Number(v.y2) : null,
              recorded_by: ctx.profileId,
            })
        })

        if (upserts.length > 0) {
          const { error } = await supabase
            .from('cass_scores')
            .upsert(upserts, { onConflict: 'cass_session_id,class_id,subject,student_id' })
          if (error) throw error
        }
        if (cleared.length > 0) {
          const { error } = await supabase
            .from('cass_scores')
            .delete()
            .eq('cass_session_id', session.id)
            .eq('class_id', ctx.classId)
            .eq('subject', ctx.subject)
            .in('student_id', cleared)
          if (error) throw error
        }

        // forget only what hasn't changed again while saving
        snapshot.forEach((v, studentId) => {
          const now = dirtyRef.current.get(studentId)
          if (now && now.y1 === v.y1 && now.y2 === v.y2) dirtyRef.current.delete(studentId)
        })

        setSaveError(null)
        if (dirtyRef.current.size > 0) {
          setSaveState('saving')
          timerRef.current = setTimeout(() => void flush(), 0)
        } else setSaveState('saved')
        return true
      } catch (e) {
        setSaveState('error')
        setSaveError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Could not save')
        timerRef.current = setTimeout(() => void flush(), RETRY_DELAY)
        return false
      }
    })()

    flushingRef.current = run
    try {
      return await run
    } finally {
      if (flushingRef.current === run) flushingRef.current = null
    }
  }, [session.id])

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY)
  }

  useEffect(() => {
    if (view !== 'scores') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onLeave = () => void flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('online', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('online', onLeave)
      void flush()
    }
  }, [view, flush])

  function resetEditor() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    dirtyRef.current = new Map()
    setSaveState('idle')
    setSaveError(null)
  }

  /* ---------------- actions ---------------- */

  function pickClass(id: string) {
    setClassId(id)
    setSubject(contexts.find((c) => c.classId === id)?.subjects[0] ?? '')
  }

  async function openSheet() {
    if (!classId || !subject || !profile) return
    resetEditor()
    setOpening(true)
    setLoadError(null)
    setSearchQuery('')
    setRowFilter('all')

    const [studentsRes, scoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', classId).eq('is_active', true).order('full_name'),
      supabase
        .from('cass_scores')
        .select('student_id, year1_score, year2_score')
        .eq('cass_session_id', session.id)
        .eq('class_id', classId)
        .eq('subject', subject),
    ])

    if (studentsRes.error || scoresRes.error) {
      setLoadError(studentsRes.error?.message ?? scoresRes.error?.message ?? 'Could not load the class')
      setOpening(false)
      return
    }

    editRef.current = { classId, subject, profileId: profile.id }
    setStudents((studentsRes.data as Student[] | null) ?? [])
    const map: Record<string, Pair> = {}
    for (const r of (scoresRes.data ?? []) as { student_id: string; year1_score: number | null; year2_score: number | null }[]) {
      map[r.student_id] = {
        y1: r.year1_score === null ? '' : String(r.year1_score),
        y2: r.year2_score === null ? '' : String(r.year2_score),
      }
    }
    setScores(map)
    setOpening(false)
    setView('scores')
  }

  async function leave() {
    if (view === 'scores') {
      const ok = await flush()
      if (!ok) {
        setSaveError("Some scores haven't saved yet. Check your connection and tap retry.")
        return
      }
      setView('pick')
      return
    }
    onBack()
  }

  function handleChange(studentId: string, field: 'y1' | 'y2', raw: string) {
    let value = raw
    if (raw !== '') {
      const parsed = Number(raw)
      if (isNaN(parsed)) return
      if (parsed < 0) value = '0'
      else if (parsed > 100) value = '100'
    }
    const current = scores[studentId] ?? { y1: '', y2: '' }
    const next: Pair = { ...current, [field]: value }
    setScores((prev) => ({ ...prev, [studentId]: next }))
    dirtyRef.current.set(studentId, next)
    scheduleSave()
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (['-', '+', 'e', 'E'].includes(e.key)) {
      e.preventDefault()
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-cass-input]'))
    const next = inputs[inputs.indexOf(e.currentTarget) + 1]
    if (next) {
      next.focus()
      next.select()
    } else e.currentTarget.blur()
  }

  /* ---------------- derived ---------------- */

  const isComplete = (id: string) => has(scores[id]?.y1) && has(scores[id]?.y2)
  const isStarted = (id: string) => has(scores[id]?.y1) || has(scores[id]?.y2)

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return students
      .map((s, i) => ({ s, sn: i + 1 }))
      .filter(({ s }) => (q ? s.full_name.toLowerCase().includes(q) : true))
      .filter(({ s }) => {
        if (rowFilter === 'all') return true
        const done = has(scores[s.id]?.y1) && has(scores[s.id]?.y2)
        return rowFilter === 'entered' ? done : !done
      })
  }, [students, searchQuery, rowFilter, scores])

  const completeCount = students.filter((s) => isComplete(s.id)).length
  const startedCount = students.filter((s) => isStarted(s.id)).length
  const progressPct = students.length ? Math.round((completeCount / students.length) * 100) : 0

  /* ---------------- views ---------------- */

  if (view === 'pick') {
    return (
      <div>
        <button onClick={leave} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-royal-900">CASS</h1>
          <span className="rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">{session.academic_year}</span>
        </div>
        <p className="text-sm text-gray-500">Choose the subject you are entering CASS scores for.</p>

        <div className="mt-4 max-w-xl space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Class</p>
            {contexts.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {contexts.map((c) => (
                  <button
                    key={c.classId}
                    type="button"
                    onClick={() => pickClass(c.classId)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      c.classId === classId
                        ? 'border-royal-600 bg-royal-600 text-white shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-royal-300 hover:text-royal-700'
                    }`}
                  >
                    {c.className}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-royal-900">
                <GraduationCap className="h-4 w-4 text-royal-600" />
                {activeContext?.className}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Subject</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeContext?.subjects.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    s === subject
                      ? 'border-royal-600 bg-royal-600 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-royal-300 hover:text-royal-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {validSubjects && contexts.length === 0 && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              None of your assigned subjects match the current subject list. Please ask the administrator to update your subject assignment.
            </p>
          )}
          {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{loadError}</p>}

          <button
            onClick={() => void openSheet()}
            disabled={!subject || opening}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            Enter CASS scores
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button onClick={leave} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-royal-900">
            CASS <span className="text-sm font-normal text-gray-400">each score out of 100</span>
          </h1>
          <p className="text-sm text-gray-500">
            {subject} · {activeContext?.className} · {session.academic_year}
          </p>
        </div>
        <SaveStatus state={saveState} onRetry={() => void flush()} />
      </div>

      {saveError && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {saveError}
        </p>
      )}

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-royal-900">
            {completeCount} of {students.length} complete
          </span>
          <span className="text-xs font-semibold text-gray-400">{progressPct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${completeCount === students.length && students.length > 0 ? 'bg-green-500' : 'bg-royal-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {startedCount > completeCount && (
          <p className="mt-2 text-xs text-amber-600">
            {startedCount - completeCount} student{startedCount - completeCount === 1 ? ' has' : 's have'} only one of the two scores.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
        </div>
        <div className="inline-flex w-fit rounded-xl bg-gray-100 p-1">
          {(
            [
              ['all', 'All'],
              ['pending', 'Incomplete'],
              ['entered', 'Complete'],
            ] as [RowFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRowFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                rowFilter === key ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500 hover:text-royal-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:px-4">
          <span className="w-6 shrink-0 text-center">#</span>
          <span className="min-w-0 flex-1 pl-12">Student</span>
          <span className="w-20 shrink-0 text-center">Year 1</span>
          <span className="w-20 shrink-0 text-center">Year 2</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            {students.length === 0
              ? 'No active students in this class.'
              : rowFilter === 'pending' && !searchQuery
                ? 'Every student has both scores. Nice work!'
                : 'No students match.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(({ s, sn }) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-400">{sn}</span>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-royal-50 text-xs font-bold text-royal-600">
                  {initials(s.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-royal-900">{s.full_name}</p>
                  {s.admission_number && <p className="truncate text-[11px] text-gray-400">{s.admission_number}</p>}
                </div>
                {(['y1', 'y2'] as const).map((field) => (
                  <input
                    key={field}
                    data-cass-input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    min={0}
                    max={100}
                    value={scores[s.id]?.[field] ?? ''}
                    onChange={(e) => handleChange(s.id, field, e.target.value)}
                    onKeyDown={handleKey}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="000"
                    aria-label={`${field === 'y1' ? 'Year 1' : 'Year 2'} CASS score for ${s.full_name}`}
                    className={`w-20 shrink-0 rounded-xl border px-2 py-2 text-center text-sm font-bold outline-none transition focus:ring-2 ${scoreInputClasses(
                      scores[s.id]?.[field],
                    )}`}
                  />
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-gray-400">
        Press Enter to move to the next box. Clear both boxes to remove a student's CASS scores.
      </p>
    </div>
  )
}
