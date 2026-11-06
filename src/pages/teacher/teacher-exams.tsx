import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Search,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  GraduationCap,
  ChevronRight,
  Cloud,
  CloudOff,
  Loader2,
  FileText,
  ClipboardCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { isBasic9 } from '@/lib/report-card'
import TeacherCassEntry, { type CassContext, type CassSessionInfo } from '@/pages/teacher/teacher-cass-entry'

type GroupKey = 'creche_nursery' | 'kg_basic6' | 'jhs'

const AUTOSAVE_DELAY = 700 // ms after the last keystroke
const RETRY_DELAY = 5000 // ms before retrying a failed save

interface TeachingContext {
  classId: string
  className: string
  levelGroup: string | null
  subjects: string[]
}

interface ExamSession {
  id: string
  group_key: GroupKey
  exam_type: string
  term: string
  start_date: string
  end_date: string
}

interface Student {
  id: string
  full_name: string
  admission_number: string
}

interface RecordedScoreSummary {
  classId: string
  subject: string
  className: string
  count: number
  avgScore: number
  lastUpdated: string
}

type View = 'home' | 'pick-context' | 'scores'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type RowFilter = 'all' | 'pending' | 'entered'
type ToastState = { type: 'success' | 'error'; message: string } | null

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysLeft(endDate: string) {
  return Math.round((Date.parse(endDate) - Date.parse(todayISO())) / 86400000)
}

function toExamGroupKey(level: string | null): GroupKey | null {
  if (level === 'creche' || level === 'nursery') return 'creche_nursery'
  if (level === 'kg' || level === 'lower_primary' || level === 'upper_primary') return 'kg_basic6'
  if (level === 'jhs') return 'jhs'
  return null
}

function scoreInputClasses(score: string | undefined) {
  const neutral = 'border-gray-200 bg-white text-royal-900 focus:border-royal-500 focus:ring-royal-100'
  if (!score) return neutral
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

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  return (
    <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div
        className={`flex items-center gap-2 rounded-xl px-4 py-3 text-white shadow-lg ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}
      >
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        <p className="text-sm font-medium">{toast.message}</p>
      </div>
    </div>
  )
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-royal-50 px-3 py-1 text-xs font-semibold text-royal-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...
      </span>
    )
  }
  if (state === 'error') {
    return (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        <CloudOff className="h-3.5 w-3.5" /> Not saved · Tap to retry
      </button>
    )
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> {offline ? 'Saved on phone · will sync' : 'All changes saved'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
      <Cloud className="h-3.5 w-3.5" /> Auto-save on
    </span>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-royal-600 bg-royal-600 text-white shadow-sm'
          : 'border-gray-200 bg-white text-gray-600 hover:border-royal-300 hover:text-royal-700'
      }`}
    >
      {children}
    </button>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-none text-royal-900">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function TeacherExams() {
  const { profile } = useAuth()
  const [contexts, setContexts] = useState<TeachingContext[]>([])
  const [sessions, setSessions] = useState<ExamSession[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('home')

  const [activeSession, setActiveSession] = useState<ExamSession | null>(null)
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [opening, setOpening] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  const [recentSummaries, setRecentSummaries] = useState<RecordedScoreSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [cassSessions, setCassSessions] = useState<CassSessionInfo[]>([])
  const [activeCass, setActiveCass] = useState<CassSessionInfo | null>(null)

  const closeToast = useCallback(() => setToast(null), [])

  /* ---------------- auto-save machinery ---------------- */

  // What the scores on screen belong to; fixed when a sheet is opened
  const editRef = useRef<{ sessionId: string; classId: string; subject: string; profileId: string } | null>(null)
  const dirtyRef = useRef<Map<string, string>>(new Map()) // studentId -> latest raw value ('' = cleared)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushingRef = useRef<Promise<boolean> | null>(null)

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // let any save already in flight finish first, so saves never overlap
    while (flushingRef.current) await flushingRef.current
    if (dirtyRef.current.size === 0) return true

    const run = (async (): Promise<boolean> => {
      const ctx = editRef.current
      if (!ctx) return false

      const snapshot = new Map(dirtyRef.current)
      setSaveState('saving')

      try {
        const upserts: {
          exam_session_id: string
          class_id: string
          subject: string
          student_id: string
          score: number
          recorded_by: string
        }[] = []
        const cleared: string[] = []
        snapshot.forEach((value, studentId) => {
          if (value === '') cleared.push(studentId)
          else
            upserts.push({
              exam_session_id: ctx.sessionId,
              class_id: ctx.classId,
              subject: ctx.subject,
              student_id: studentId,
              score: Number(value),
              recorded_by: ctx.profileId,
            })
        })

        if (upserts.length > 0) {
          const { error } = await supabase
            .from('exam_scores')
            .upsert(upserts, { onConflict: 'exam_session_id,class_id,subject,student_id' })
          if (error) throw error
        }
        if (cleared.length > 0) {
          const { error } = await supabase
            .from('exam_scores')
            .delete()
            .eq('exam_session_id', ctx.sessionId)
            .eq('class_id', ctx.classId)
            .eq('subject', ctx.subject)
            .in('student_id', cleared)
          if (error) throw error
        }

        // Only forget values that haven't changed again while we were saving
        snapshot.forEach((value, studentId) => {
          if (dirtyRef.current.get(studentId) === value) dirtyRef.current.delete(studentId)
        })

        if (dirtyRef.current.size > 0) {
          setSaveState('saving')
          timerRef.current = setTimeout(() => void flush(), 0)
        } else {
          setSaveState('saved')
        }
        return true
      } catch {
        setSaveState('error')
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
  }, [])

  function scheduleSave(delay = AUTOSAVE_DELAY) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(() => void flush(), delay)
  }

  // Save on tab hide, page close, coming back online, and when leaving the screen
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
  }

  /* ---------------- loading ---------------- */

  async function loadAll() {
    if (!profile) return
    setLoading(true)

    const [myClassRes, assignmentsRes] = await Promise.all([
      supabase.from('classes').select('id, name, level_group').eq('teacher_id', profile.id).maybeSingle(),
      supabase
        .from('subject_assignments')
        .select('subject, class_id, class:classes(name, level_group)')
        .eq('teacher_id', profile.id),
    ])

    const map = new Map<string, TeachingContext>()

    if (myClassRes.data) {
      let subjectNames: string[] = []
      if (myClassRes.data.level_group && myClassRes.data.level_group !== 'jhs') {
        const { data: subjectRows } = await supabase
          .from('subjects')
          .select('name')
          .eq('level_group', myClassRes.data.level_group)
          .order('name')
        subjectNames = (subjectRows ?? []).map((s) => s.name)
      }
      map.set(myClassRes.data.id, {
        classId: myClassRes.data.id,
        className: myClassRes.data.name,
        levelGroup: myClassRes.data.level_group,
        subjects: subjectNames,
      })
    }

    for (const row of (assignmentsRes.data as unknown as {
      subject: string
      class_id: string
      class: { name: string; level_group: string | null } | null
    }[]) ?? []) {
      const existing = map.get(row.class_id)
      if (existing) {
        if (!existing.subjects.includes(row.subject)) existing.subjects.push(row.subject)
      } else {
        map.set(row.class_id, {
          classId: row.class_id,
          className: row.class?.name ?? '',
          levelGroup: row.class?.level_group ?? null,
          subjects: [row.subject],
        })
      }
    }

    const contextList = Array.from(map.values())
    setContexts(contextList)

    const groupKeys = Array.from(
      new Set(contextList.map((c) => toExamGroupKey(c.levelGroup)).filter((g): g is GroupKey => g !== null)),
    )

    if (groupKeys.length > 0) {
      const { data: sessionRows } = await supabase
        .from('exam_sessions')
        .select('id, group_key, exam_type, term, start_date, end_date')
        .in('group_key', groupKeys)
        .eq('is_active', true)
        .lte('start_date', todayISO())
        .gte('end_date', todayISO())
        .order('start_date', { ascending: false })
      setSessions((sessionRows as unknown as ExamSession[]) ?? [])
    } else {
      setSessions([])
    }

    // CASS is only for JHS subject teachers, and only for Basic 9
    const cassClasses = contextList.filter((c) => c.levelGroup === 'jhs' && isBasic9(c.className) && c.subjects.length > 0)
    if (cassClasses.length > 0) {
      const { data: cassRows } = await supabase
        .from('cass_sessions')
        .select('id, academic_year, start_date, end_date')
        .eq('is_active', true)
        .lte('start_date', todayISO())
        .gte('end_date', todayISO())
        .order('start_date', { ascending: false })
      setCassSessions((cassRows as CassSessionInfo[] | null) ?? [])
    } else {
      setCassSessions([])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const cassContexts = useMemo<CassContext[]>(
    () =>
      contexts
        .filter((c) => c.levelGroup === 'jhs' && isBasic9(c.className) && c.subjects.length > 0)
        .map((c) => ({ classId: c.classId, className: c.className, subjects: c.subjects })),
    [contexts],
  )

  const contextsForSession = useMemo(() => {
    if (!activeSession) return []
    return contexts.filter((c) => toExamGroupKey(c.levelGroup) === activeSession.group_key)
  }, [contexts, activeSession])

  async function loadRecent(sessionId: string) {
    if (!profile) return
    setLoadingRecent(true)
    const { data } = await supabase
      .from('exam_scores')
      .select('subject, class_id, score, created_at, class:classes(name)')
      .eq('exam_session_id', sessionId)
      .eq('recorded_by', profile.id)

    const summaryMap = new Map<
      string,
      { classId: string; subject: string; total: number; sum: number; className: string; last: string }
    >()
    for (const row of (data ?? []) as unknown as {
      subject: string
      class_id: string
      score: number
      created_at: string
      class: { name: string } | null
    }[]) {
      const key = `${row.class_id}|${row.subject}`
      const existing = summaryMap.get(key) ?? {
        classId: row.class_id,
        subject: row.subject,
        total: 0,
        sum: 0,
        className: row.class?.name ?? 'Class',
        last: row.created_at,
      }
      existing.total += 1
      existing.sum += Number(row.score) || 0
      if (row.created_at > existing.last) existing.last = row.created_at
      summaryMap.set(key, existing)
    }

    const summaries: RecordedScoreSummary[] = []
    summaryMap.forEach((val) => {
      summaries.push({
        classId: val.classId,
        subject: val.subject,
        className: val.className,
        count: val.total,
        avgScore: Math.round(val.sum / val.total),
        lastUpdated: new Date(val.last).toLocaleDateString(),
      })
    })
    summaries.sort((a, b) => a.subject.localeCompare(b.subject))
    setRecentSummaries(summaries)
    setLoadingRecent(false)
  }

  /* ---------------- navigation / actions ---------------- */

  function openSession(session: ExamSession) {
    resetEditor()
    setActiveSession(session)
    setToast(null)
    setSearchQuery('')
    setRowFilter('all')
    const matches = contexts.filter((c) => toExamGroupKey(c.levelGroup) === session.group_key)
    setClassId(matches[0]?.classId ?? '')
    setSubject(matches[0]?.subjects[0] ?? '')
    setRecentSummaries([])
    setView('pick-context')
    void loadRecent(session.id)
  }

  function pickClass(id: string) {
    setClassId(id)
    const ctx = contextsForSession.find((c) => c.classId === id)
    setSubject(ctx?.subjects[0] ?? '')
  }

  async function goToScores(targetClassId?: string, targetSubject?: string) {
    const cId = targetClassId || classId
    const sub = targetSubject || subject
    if (!cId || !sub || !activeSession || !profile) return

    resetEditor()
    setOpening(true)
    setClassId(cId)
    setSubject(sub)
    setSearchQuery('')
    setRowFilter('all')

    const [studentsRes, scoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', cId).eq('is_active', true).order('full_name'),
      supabase
        .from('exam_scores')
        .select('student_id, score')
        .eq('exam_session_id', activeSession.id)
        .eq('class_id', cId)
        .eq('subject', sub),
    ])

    editRef.current = { sessionId: activeSession.id, classId: cId, subject: sub, profileId: profile.id }
    setStudents((studentsRes.data as Student[] | null) ?? [])
    const map: Record<string, string> = {}
    for (const row of scoresRes.data ?? []) map[row.student_id] = String(row.score)
    setScores(map)
    setOpening(false)
    setView('scores')
  }

  async function leaveScores() {
    const ok = await flush()
    if (!ok) {
      setToast({ type: 'error', message: "Some scores haven't saved yet. Check your connection and tap retry." })
      return
    }
    setView('pick-context')
    if (activeSession) void loadRecent(activeSession.id)
  }

  function handleScoreChange(studentId: string, raw: string) {
    if (raw === '') {
      setScores((prev) => ({ ...prev, [studentId]: '' }))
      dirtyRef.current.set(studentId, '')
      scheduleSave()
      return
    }
    const parsed = Number(raw)
    if (isNaN(parsed)) return
    let value = raw
    if (parsed < 0) value = '0'
    else if (parsed > 100) value = '100'
    setScores((prev) => ({ ...prev, [studentId]: value }))
    dirtyRef.current.set(studentId, value)
    scheduleSave()
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (['-', '+', 'e', 'E'].includes(e.key)) {
      e.preventDefault()
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-score-input]'))
    const next = inputs[inputs.indexOf(e.currentTarget) + 1]
    if (next) {
      next.focus()
      next.select()
    } else {
      e.currentTarget.blur()
    }
  }

  /* ---------------- derived ---------------- */

  const activeContext = useMemo(() => contexts.find((c) => c.classId === classId) ?? null, [contexts, classId])
  const isEntered = (id: string) => scores[id] !== undefined && scores[id] !== ''

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return students
      .map((s, i) => ({ s, sn: i + 1 }))
      .filter(({ s }) => (q ? s.full_name.toLowerCase().includes(q) : true))
      .filter(({ s }) => {
        if (rowFilter === 'all') return true
        const done = scores[s.id] !== undefined && scores[s.id] !== ''
        return rowFilter === 'entered' ? done : !done
      })
  }, [students, searchQuery, rowFilter, scores])

  const enteredValues = students.filter((s) => isEntered(s.id)).map((s) => Number(scores[s.id]))
  const enteredCount = enteredValues.length
  const average = enteredCount ? enteredValues.reduce((a, b) => a + b, 0) / enteredCount : null
  const highest = enteredCount ? Math.max(...enteredValues) : null
  const lowest = enteredCount ? Math.min(...enteredValues) : null
  const progressPct = students.length ? Math.round((enteredCount / students.length) * 100) : 0
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  /* ---------------- views ---------------- */

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-lg bg-gray-200" />
        <div className="h-24 rounded-2xl bg-gray-200" />
        <div className="h-40 rounded-2xl bg-gray-200" />
      </div>
    )
  }

  /* ----- CASS (Basic 9 subject teachers) ----- */
  if (activeCass) {
    return <TeacherCassEntry session={activeCass} contexts={cassContexts} onBack={() => setActiveCass(null)} />
  }

  /* ----- HOME ----- */
  if (view === 'home') {
    return (
      <div>
        <div className="relative overflow-hidden rounded-3xl bg-royal-700 p-5 text-white shadow-md sm:p-6">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-12 right-16 h-28 w-28 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 text-royal-100">
              <FileText className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Exams</span>
            </div>
            <h1 className="mt-1 text-xl font-bold sm:text-2xl">Examination scores</h1>
            <p className="mt-1 max-w-md text-sm text-royal-100">
              Pick an open exam window to enter or update scores. Every score saves the moment you type it.
            </p>
          </div>
        </div>

        {sessions.length === 0 && cassSessions.length === 0 ? (
          <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-royal-50 text-royal-600">
              <CalendarClock className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-royal-900">No exams open right now</p>
            <p className="mt-1 text-sm text-gray-400">When the administrator opens an exam window, it will show up here.</p>
          </div>
        ) : (
          <>
            <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Open exam windows</h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cassSessions.map((c) => {
                const left = daysLeft(c.end_date)
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveCass(c)}
                    className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{c.academic_year}</span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white transition group-hover:scale-105">
                        <ClipboardCheck className="h-4 w-4" />
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-royal-900">CASS</h3>
                    <p className="text-xs text-gray-500">Basic 9 · Year 1 and Year 2 scores</p>
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
                      <span className="text-gray-500">Closes {new Date(c.end_date).toLocaleDateString()}</span>
                      <span
                        className={`rounded-full px-2.5 py-1 font-bold ${
                          left <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {left <= 0 ? 'Last day' : left === 1 ? '1 day left' : `${left} days left`}
                      </span>
                    </div>
                  </button>
                )
              })}
              {sessions.map((s) => {
                const left = daysLeft(s.end_date)
                const urgent = left <= 3
                return (
                  <button
                    key={s.id}
                    onClick={() => openSession(s)}
                    className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-royal-50 px-3 py-1 text-xs font-bold text-royal-700">{s.term}</span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-royal-600 text-white transition group-hover:scale-105">
                        <CalendarClock className="h-4 w-4" />
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-royal-900">{s.exam_type}</h3>
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
                      <span className="text-gray-500">
                        Closes {new Date(s.end_date).toLocaleDateString()}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 font-bold ${
                          urgent ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {left <= 0 ? 'Last day' : left === 1 ? '1 day left' : `${left} days left`}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  /* ----- PICK CLASS + SUBJECT ----- */
  if (view === 'pick-context') {
    const noSubjects = activeContext && activeContext.subjects.length === 0
    return (
      <div>
        <button onClick={() => setView('home')} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-royal-900">{activeSession?.exam_type}</h1>
          <span className="rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">{activeSession?.term}</span>
        </div>
        <p className="text-sm text-gray-500">Choose what you are entering scores for.</p>

        <div className="mt-4 max-w-xl space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Class</p>
            {contextsForSession.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {contextsForSession.map((c) => (
                  <Chip key={c.classId} active={c.classId === classId} onClick={() => pickClass(c.classId)}>
                    {c.className}
                  </Chip>
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
            {noSubjects ? (
              <p className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                No subjects are assigned to you for this class. Please contact your administrator.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {activeContext?.subjects.map((s) => (
                  <Chip key={s} active={s === subject} onClick={() => setSubject(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => void goToScores()}
            disabled={!subject || noSubjects === true || opening}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            Enter scores
          </button>
        </div>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Scores you've recorded</h2>
        {loadingRecent ? (
          <div className="mt-3 h-16 max-w-xl animate-pulse rounded-2xl bg-gray-200" />
        ) : recentSummaries.length === 0 ? (
          <p className="mt-3 max-w-xl rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-400">
            Nothing recorded for this exam yet.
          </p>
        ) : (
          <div className="mt-3 grid max-w-xl gap-2">
            {recentSummaries.map((sum) => (
              <button
                key={`${sum.classId}|${sum.subject}`}
                onClick={() => void goToScores(sum.classId, sum.subject)}
                className="group flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-royal-900">{sum.subject}</p>
                    <p className="text-xs text-gray-500">
                      {sum.className} · Updated {sum.lastUpdated}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">
                      {sum.count} scored
                    </span>
                    <p className="mt-1 text-xs text-gray-400">Avg {sum.avgScore}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-royal-600" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ----- SCORES ----- */
  return (
    <div>
      <button onClick={leaveScores} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-royal-900">
            {activeSession?.exam_type} <span className="text-sm font-normal text-gray-400">/ 100</span>
          </h1>
          <p className="text-sm text-gray-500">
            {subject} · {activeContext?.className} · {activeSession?.term}
          </p>
        </div>
        <SaveStatus state={saveState} onRetry={() => void flush()} />
      </div>

      {/* progress */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-royal-900">
            {enteredCount} of {students.length} entered
          </span>
          <span className="text-xs font-semibold text-gray-400">{progressPct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${
              enteredCount === students.length && students.length > 0 ? 'bg-green-500' : 'bg-royal-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {average !== null && highest !== null && lowest !== null && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatTile label="Average" value={fmt(average)} />
            <StatTile label="Highest" value={fmt(highest)} />
            <StatTile label="Lowest" value={fmt(lowest)} />
          </div>
        )}
      </div>

      {/* search + filter */}
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
              ['pending', 'Not entered'],
              ['entered', 'Entered'],
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

      {/* students */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            {students.length === 0
              ? 'No active students in this class.'
              : rowFilter === 'pending' && !searchQuery
                ? 'Everyone has a score. Nice work!'
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
                <input
                  data-score-input
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  min={0}
                  max={100}
                  value={scores[s.id] ?? ''}
                  onChange={(e) => handleScoreChange(s.id, e.target.value)}
                  onKeyDown={handleKey}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="—"
                  aria-label={`Score for ${s.full_name}`}
                  className={`w-20 rounded-xl border px-2 py-2 text-center text-sm font-bold outline-none transition focus:ring-2 ${scoreInputClasses(
                    scores[s.id],
                  )}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-gray-400">
        Press Enter to jump to the next student. Clear a box to remove that score.
      </p>

      <Toast toast={toast} onClose={closeToast} />
    </div>
  )
}