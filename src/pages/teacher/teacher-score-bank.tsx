import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Plus,
  BookOpen,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Cloud,
  CloudOff,
  Loader2,
  ClipboardList,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const TITLE_SUGGESTIONS = ['Task 1', 'Task 2', 'Quiz 1', 'Quiz 2', 'Class Test', 'Group Work', 'Portfolio']
const TOTAL_SUGGESTIONS = [10, 15, 20, 25, 30, 50, 100]
const AUTOSAVE_DELAY = 700 // ms after the last keystroke
const RETRY_DELAY = 5000 // ms before retrying a failed save

interface TeachingContext {
  classId: string
  className: string
  subjects: string[]
}

interface Student {
  id: string
  full_name: string
  admission_number: string
}

interface RecentEntry {
  id: string
  class_id: string
  title: string
  subject: string
  term: string
  total_score: number
  created_at: string
  class: { name: string } | null
}

interface SubjectGroup {
  key: string
  subject: string
  className: string
  entries: RecentEntry[]
}

type EntryStats = Record<string, { count: number; sum: number }>
type View = 'home' | 'new' | 'scores'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type RowFilter = 'all' | 'pending' | 'entered'
type ToastState = { type: 'success' | 'error'; message: string } | null

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function percentTone(pct: number) {
  if (pct < 50) return 'red'
  if (pct < 80) return 'amber'
  return 'green'
}

function scoreInputClasses(score: string | undefined, total: number) {
  const neutral = 'border-gray-200 bg-white text-royal-900 focus:border-royal-500 focus:ring-royal-100'
  if (!score) return neutral
  const num = Number(score)
  if (isNaN(num) || total <= 0) return neutral
  const tone = percentTone((num / total) * 100)
  if (tone === 'red') return 'border-red-300 bg-red-50 text-red-700 focus:border-red-400 focus:ring-red-100'
  if (tone === 'amber') return 'border-amber-300 bg-amber-50 text-amber-700 focus:border-amber-400 focus:ring-amber-100'
  return 'border-green-300 bg-green-50 text-green-700 focus:border-green-400 focus:ring-green-100'
}

function toneBar(pct: number) {
  const tone = percentTone(pct)
  if (tone === 'red') return 'bg-red-400'
  if (tone === 'amber') return 'bg-amber-400'
  return 'bg-green-500'
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
    const t = setTimeout(onClose, 2800)
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
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

export default function TeacherScoreBank() {
  const { profile } = useAuth()
  const [contexts, setContexts] = useState<TeachingContext[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [stats, setStats] = useState<EntryStats>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('home')

  // entry being created / edited
  const [classId, setClassId] = useState('')
  const [className, setClassName] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState(TERMS[0])
  const [title, setTitle] = useState('')
  const [totalScore, setTotalScore] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // UI state
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  const [termFilter, setTermFilter] = useState<string>('All')
  const [entryToDelete, setEntryToDelete] = useState<RecentEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const closeToast = useCallback(() => setToast(null), [])

  /* ---------------- auto-save machinery ---------------- */

  // Latest values, readable from timers / event listeners without stale closures
  const latest = useRef({ profileId: '', classId: '', subject: '', term: '', title: '', totalScore: '' })
  latest.current = {
    profileId: profile?.id ?? '',
    classId,
    subject,
    term,
    title,
    totalScore,
  }

  const entryIdRef = useRef<string | null>(null) // id of the entry on screen
  const persistedRef = useRef(false) // has the entry row been created in the database yet?
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
      const ctx = latest.current
      const entryId = entryIdRef.current
      if (!entryId || !ctx.profileId) return false

      const snapshot = new Map(dirtyRef.current)
      setSaveState('saving')

      try {
        // The entry row is created together with the very first score typed
        if (!persistedRef.current) {
          const { error } = await supabase.from('score_bank_entries').insert({
            id: entryId,
            class_id: ctx.classId,
            subject: ctx.subject,
            term: ctx.term,
            title: ctx.title.trim(),
            total_score: Number(ctx.totalScore),
            teacher_id: ctx.profileId,
          })
          if (error) throw error
          persistedRef.current = true
        }

        const upserts: { entry_id: string; student_id: string; score: number }[] = []
        const cleared: string[] = []
        snapshot.forEach((value, studentId) => {
          if (value === '') cleared.push(studentId)
          else upserts.push({ entry_id: entryId, student_id: studentId, score: Number(value) })
        })

        if (upserts.length > 0) {
          const { error } = await supabase.from('score_bank_scores').upsert(upserts, { onConflict: 'entry_id,student_id' })
          if (error) throw error
        }
        if (cleared.length > 0) {
          const { error } = await supabase.from('score_bank_scores').delete().eq('entry_id', entryId).in('student_id', cleared)
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
    persistedRef.current = false
    entryIdRef.current = null
    setSaveState('idle')
  }

  /* ---------------- loading ---------------- */

  async function loadContexts() {
    if (!profile) return
    const [myClassRes, assignmentsRes] = await Promise.all([
      supabase.from('classes').select('id, name, level_group').eq('teacher_id', profile.id).maybeSingle(),
      supabase
        .from('subject_assignments')
        .select('subject, class_id, class:classes(name)')
        .eq('teacher_id', profile.id),
    ])

    const map = new Map<string, TeachingContext>()

    if (myClassRes.data) {
      let subjectNames: string[] = []
      if (myClassRes.data.level_group) {
        const { data: subjectRows } = await supabase
          .from('subjects')
          .select('name')
          .eq('level_group', myClassRes.data.level_group)
          .order('name')
        subjectNames = (subjectRows ?? []).map((s) => s.name)
      }
      map.set(myClassRes.data.id, { classId: myClassRes.data.id, className: myClassRes.data.name, subjects: subjectNames })
    }

    for (const row of (assignmentsRes.data as unknown as { subject: string; class_id: string; class: { name: string } | null }[]) ?? []) {
      const existing = map.get(row.class_id)
      if (existing) {
        if (!existing.subjects.includes(row.subject)) existing.subjects.push(row.subject)
      } else {
        map.set(row.class_id, { classId: row.class_id, className: row.class?.name ?? '', subjects: [row.subject] })
      }
    }

    setContexts(Array.from(map.values()))
  }

  // How many students have scores in each entry, and the sum, so the cards can show progress and average
  async function loadStats(entries: RecentEntry[]) {
    if (entries.length === 0) {
      setStats({})
      return
    }
    const ids = entries.map((e) => e.id)
    const acc: EntryStats = {}
    try {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('score_bank_scores')
          .select('entry_id, student_id, score')
          .in('entry_id', ids)
          .order('entry_id')
          .order('student_id')
          .range(from, from + 999)
        if (error || !data) return // keep whatever we had; cards just won't show numbers
        for (const row of data as { entry_id: string; score: number }[]) {
          const cur = acc[row.entry_id] ?? { count: 0, sum: 0 }
          cur.count += 1
          cur.sum += Number(row.score)
          acc[row.entry_id] = cur
        }
        if (data.length < 1000) break
      }
      setStats(acc)
    } catch {
      /* offline or failed: ignore */
    }
  }

  async function loadRecent() {
    if (!profile) return
    const { data } = await supabase
      .from('score_bank_entries')
      .select('id, class_id, title, subject, term, total_score, created_at, class:classes(name)')
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
    const entries = (data as unknown as RecentEntry[]) ?? []
    setRecent(entries)
    void loadStats(entries)
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadContexts(), loadRecent()])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function fetchStudents(cId: string) {
    const { data } = await supabase
      .from('students')
      .select('id, full_name, admission_number')
      .eq('class_id', cId)
      .eq('is_active', true)
      .order('full_name')
    return (data as Student[] | null) ?? []
  }

  /* ---------------- navigation / actions ---------------- */

  function startCreate() {
    resetEditor()
    const first = contexts[0]
    setClassId(first?.classId ?? '')
    setClassName(first?.className ?? '')
    setSubject(first?.subjects[0] ?? '')
    setTerm(TERMS[0])
    setTitle('')
    setTotalScore('')
    setMessage(null)
    setSearchQuery('')
    setRowFilter('all')
    setView('new')
  }

  function pickClass(id: string) {
    const ctx = contexts.find((c) => c.classId === id)
    setClassId(id)
    setClassName(ctx?.className ?? '')
    setSubject(ctx?.subjects[0] ?? '')
  }

  async function startScores() {
    if (!classId || !subject) {
      setMessage('Choose a class and a subject.')
      return
    }
    if (!title.trim()) {
      setMessage('Enter a title, e.g. Task 1, Quiz 1, Class Test.')
      return
    }
    if (!totalScore || Number(totalScore) <= 0) {
      setMessage('Enter a valid total score.')
      return
    }
    const clash = recent.find(
      (e) =>
        e.class_id === classId &&
        e.subject === subject &&
        e.term === term &&
        e.title.trim().toLowerCase() === title.trim().toLowerCase(),
    )
    if (clash) {
      setMessage(`You already have "${clash.title}" for ${subject} in ${term}. Open it from the home page, or use a different title.`)
      return
    }

    setMessage(null)
    setStarting(true)
    const list = await fetchStudents(classId)
    setStarting(false)

    resetEditor()
    entryIdRef.current = crypto.randomUUID()
    setStudents(list)
    setScores({})
    setSearchQuery('')
    setRowFilter('all')
    setView('scores')
  }

  async function openExisting(entry: RecentEntry) {
    resetEditor()
    setMessage(null)
    setSearchQuery('')
    setRowFilter('all')
    entryIdRef.current = entry.id
    persistedRef.current = true
    setTitle(entry.title)
    setSubject(entry.subject)
    setTerm(entry.term)
    setTotalScore(String(entry.total_score))
    setClassId(entry.class_id)
    setClassName(entry.class?.name ?? '')

    const [list, scoresRes] = await Promise.all([
      fetchStudents(entry.class_id),
      supabase.from('score_bank_scores').select('student_id, score').eq('entry_id', entry.id),
    ])
    setStudents(list)
    const map: Record<string, string> = {}
    for (const row of scoresRes.data ?? []) map[row.student_id] = String(row.score)
    setScores(map)
    setView('scores')
  }

  async function leaveScores() {
    const ok = await flush()
    if (!ok) {
      setToast({ type: 'error', message: "Some scores haven't saved yet. Check your connection and tap retry." })
      return
    }
    setView('home')
    void loadRecent()
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
    const max = Number(totalScore) || 0
    let value = raw
    if (parsed < 0) value = '0'
    else if (max > 0 && parsed > max) value = String(max)
    setScores((prev) => ({ ...prev, [studentId]: value }))
    dirtyRef.current.set(studentId, value)
    scheduleSave()
  }

  function handleEnter(e: KeyboardEvent<HTMLInputElement>) {
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

  async function confirmDelete() {
    if (!entryToDelete) return
    setDeleting(true)

    const { error: scoresError } = await supabase.from('score_bank_scores').delete().eq('entry_id', entryToDelete.id)
    if (scoresError) {
      setDeleting(false)
      setToast({ type: 'error', message: scoresError.message })
      return
    }

    const { data, error } = await supabase.from('score_bank_entries').delete().eq('id', entryToDelete.id).select('id')
    setDeleting(false)

    if (error || !data || data.length === 0) {
      setToast({ type: 'error', message: error?.message ?? 'Could not delete this entry.' })
      return
    }

    setRecent((prev) => prev.filter((e) => e.id !== entryToDelete.id))
    setEntryToDelete(null)
    setToast({ type: 'success', message: 'Score entry deleted.' })
  }

  /* ---------------- derived ---------------- */

  const activeContext = useMemo(() => contexts.find((c) => c.classId === classId) ?? null, [contexts, classId])
  const total = Number(totalScore) || 0

  const visibleRecent = useMemo(
    () => (termFilter === 'All' ? recent : recent.filter((e) => e.term === termFilter)),
    [recent, termFilter],
  )

  const subjectGroups = useMemo<SubjectGroup[]>(() => {
    const map = new Map<string, SubjectGroup>()
    for (const e of visibleRecent) {
      const key = `${e.class_id}|${e.subject}`
      const group = map.get(key)
      if (group) group.entries.push(e)
      else map.set(key, { key, subject: e.subject, className: e.class?.name ?? '', entries: [e] })
    }
    return Array.from(map.values()).sort((a, b) => a.subject.localeCompare(b.subject))
  }, [visibleRecent])

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

  /* ----- HOME ----- */
  if (view === 'home') {
    return (
      <div>
        <div className="relative overflow-hidden rounded-3xl bg-royal-700 p-5 text-white shadow-md sm:p-6">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-12 right-16 h-28 w-28 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 text-royal-100">
              <ClipboardList className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Score Bank</span>
            </div>
            <h1 className="mt-1 text-xl font-bold sm:text-2xl">Record scores once, use them for SBA</h1>
            <p className="mt-1 max-w-md text-sm text-royal-100">
              Tasks, quizzes, tests and group work. Every score saves the moment you type it.
            </p>
            <button
              onClick={startCreate}
              disabled={contexts.length === 0}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-royal-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add score entry
            </button>
          </div>
        </div>

        {contexts.length === 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            You don't have a class or subject assignment yet, so the Score Bank isn't available.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your subjects</h2>
          <div className="flex gap-1.5 overflow-x-auto">
            {['All', ...TERMS].map((t) => (
              <button
                key={t}
                onClick={() => setTermFilter(t)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  termFilter === t ? 'bg-royal-600 text-white' : 'bg-white text-gray-500 hover:bg-royal-50 hover:text-royal-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {subjectGroups.length === 0 ? (
          <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-royal-50 text-royal-600">
              <BookOpen className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-royal-900">
              {recent.length === 0 ? 'No entries yet' : `Nothing in ${termFilter}`}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {recent.length === 0
                ? 'Add a score entry and its subject will appear here.'
                : 'Pick another term, or add a new entry.'}
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjectGroups.map((group) => (
              <div key={group.key} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold leading-tight text-royal-900">{group.subject}</p>
                      <p className="text-xs text-gray-500">{group.className}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">
                    {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {group.entries.map((e) => {
                    const st = stats[e.id]
                    const avgPct = st && st.count > 0 && e.total_score > 0 ? (st.sum / st.count / e.total_score) * 100 : null
                    return (
                      <div key={e.id} className="flex items-center rounded-xl bg-gray-50 transition hover:bg-royal-50">
                        <button
                          onClick={() => openExisting(e)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-royal-900">{e.title}</p>
                              <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                                {e.term}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">
                              out of {e.total_score}
                              {st ? ` · ${st.count} scored` : ''}
                              {avgPct !== null ? ` · avg ${Math.round(avgPct)}%` : ''}
                            </p>
                            {avgPct !== null && (
                              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-200">
                                <div
                                  className={`h-full rounded-full ${toneBar(avgPct)}`}
                                  style={{ width: `${Math.min(100, Math.round(avgPct))}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                        </button>
                        <button
                          onClick={() => setEntryToDelete(e)}
                          aria-label={`Delete ${e.title}`}
                          className="mr-1.5 rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {entryToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/40 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-royal-900">Delete this score entry?</h3>
              <p className="mt-1 text-sm text-gray-500">
                "{entryToDelete.title}" ({entryToDelete.subject}) and all the scores recorded in it will be permanently
                removed. This can't be undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setEntryToDelete(null)}
                  disabled={deleting}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        <Toast toast={toast} onClose={closeToast} />
      </div>
    )
  }

  /* ----- NEW ENTRY (single step) ----- */
  if (view === 'new') {
    const noSubjects = activeContext && activeContext.subjects.length === 0
    return (
      <div>
        <button onClick={() => setView('home')} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mt-2 text-xl font-bold text-royal-900">New score entry</h1>
        <p className="text-sm text-gray-500">Set it up once, then enter scores. They save as you type.</p>

        <div className="mt-4 max-w-xl space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {/* Class */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Class</p>
            {contexts.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {contexts.map((c) => (
                  <Chip key={c.classId} active={c.classId === classId} onClick={() => pickClass(c.classId)}>
                    {c.className}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm font-semibold text-royal-900">{className}</p>
            )}
          </div>

          {/* Subject */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Subject</p>
            {noSubjects ? (
              <p className="mt-1 text-xs text-red-500">
                No subjects set up for this class's level yet. Ask your administrator to add them.
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

          {/* Term */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Term</p>
            <div className="mt-2 inline-flex rounded-xl bg-gray-100 p-1">
              {TERMS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTerm(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    term === t ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500 hover:text-royal-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Task 1, Quiz 1, Class Test"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TITLE_SUGGESTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTitle(t)}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-royal-50 hover:text-royal-700"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Total */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total score</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={totalScore}
              onChange={(e) => setTotalScore(e.target.value)}
              placeholder="e.g. 15"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOTAL_SUGGESTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTotalScore(String(n))}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    totalScore === String(n) ? 'bg-royal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-royal-50 hover:text-royal-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {message && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
            </p>
          )}

          <button
            onClick={startScores}
            disabled={!subject || starting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enter scores
          </button>
        </div>
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
            {title} <span className="text-sm font-normal text-gray-400">/ {totalScore}</span>
          </h1>
          <p className="text-sm text-gray-500">
            {subject} · {className} · {term}
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
        {enteredCount > 0 && average !== null && highest !== null && lowest !== null && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatTile label="Average" value={fmt(average)} sub={total > 0 ? `${Math.round((average / total) * 100)}%` : undefined} />
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
              ? 'No students in this class.'
              : rowFilter === 'pending' && !searchQuery
                ? 'Everyone has a score. Nice work!'
                : 'No students match.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(({ s, sn }) => {
              const value = scores[s.id]
              const pct = value !== undefined && value !== '' && total > 0 ? Math.round((Number(value) / total) * 100) : null
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-400">{sn}</span>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-royal-50 text-xs font-bold text-royal-600">
                    {initials(s.full_name)}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-royal-900">{s.full_name}</p>
                  {pct !== null && <span className="hidden w-10 text-right text-xs font-semibold text-gray-400 sm:block">{pct}%</span>}
                  <input
                    data-score-input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    min={0}
                    max={total || undefined}
                    value={value ?? ''}
                    onChange={(e) => handleScoreChange(s.id, e.target.value)}
                    onKeyDown={handleEnter}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="—"
                    aria-label={`Score for ${s.full_name}`}
                    className={`w-20 rounded-xl border px-2 py-2 text-center text-sm font-bold outline-none transition focus:ring-2 ${scoreInputClasses(
                      value,
                      total,
                    )}`}
                  />
                </li>
              )
            })}
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