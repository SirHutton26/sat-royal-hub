import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Save,
  Search,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  GraduationCap,
  History,
  FileEdit,
  ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

type GroupKey = 'creche_nursery' | 'kg_basic6' | 'jhs'

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
type SubTab = 'enter' | 'recent'
type ToastState = { type: 'success' | 'error'; message: string } | null

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function toExamGroupKey(level: string | null): GroupKey | null {
  if (level === 'creche' || level === 'nursery') return 'creche_nursery'
  if (level === 'kg' || level === 'lower_primary' || level === 'upper_primary') return 'kg_basic6'
  if (level === 'jhs') return 'jhs'
  return null
}

function scoreInputClasses(score: string | undefined) {
  if (!score) return 'border-gray-200 bg-white focus:border-royal-500 focus:ring-royal-100'
  const num = Number(score)
  if (isNaN(num)) return 'border-gray-200 bg-white focus:border-royal-500 focus:ring-royal-100'
  if (num < 50) return 'border-red-300 bg-red-50/60 text-red-700 focus:ring-red-100'
  if (num < 80) return 'border-amber-300 bg-amber-50/60 text-amber-700 focus:ring-amber-100'
  return 'border-green-300 bg-green-50/60 text-green-700 focus:ring-green-100'
}

function SavingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-royal-950/50 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-royal-400 border-t-transparent" />
        <img src={schoolLogo} alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1 shadow-md" />
      </div>
      <p className="mt-4 text-sm font-semibold text-white tracking-wide">Saving scores...</p>
    </div>
  )
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  return (
    <div className="fixed inset-x-0 top-6 z-[60] flex justify-center px-4 animate-in fade-in slide-in-from-top-4">
      <div
        className={`flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-xl ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
        } text-white font-medium`}
      >
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
        <p className="text-sm">{toast.message}</p>
      </div>
    </div>
  )
}

export default function TeacherExams() {
  const { profile } = useAuth()
  const [contexts, setContexts] = useState<TeachingContext[]>([])
  const [sessions, setSessions] = useState<ExamSession[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('home')
  const [subTab, setSubTab] = useState<SubTab>('enter')

  const [activeSession, setActiveSession] = useState<ExamSession | null>(null)
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [recentSummaries, setRecentSummaries] = useState<RecordedScoreSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)

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
      new Set(contextList.map((c) => toExamGroupKey(c.levelGroup)).filter((g): g is GroupKey => g !== null))
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

    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const contextsForSession = useMemo(() => {
    if (!activeSession) return []
    return contexts.filter((c) => toExamGroupKey(c.levelGroup) === activeSession.group_key)
  }, [contexts, activeSession])

  async function openSession(session: ExamSession) {
    setActiveSession(session)
    setToast(null)
    setSearchQuery('')
    setSubTab('enter')
    const matches = contexts.filter((c) => toExamGroupKey(c.levelGroup) === session.group_key)
    const initialClassId = matches[0]?.classId ?? ''
    setClassId(initialClassId)
    setSubject(matches[0]?.subjects[0] ?? '')
    setView('pick-context')

    if (profile) {
      setLoadingRecent(true)
      const { data } = await supabase
        .from('exam_scores')
        .select('subject, class_id, score, created_at, class:classes(name)')
        .eq('exam_session_id', session.id)
        .eq('recorded_by', profile.id)

      const summaryMap = new Map<string, { total: number; sum: number; className: string; last: string }>()
      for (const row of (data ?? []) as unknown as { subject: string; class_id: string; score: number; created_at: string; class: { name: string } | null }[]) {
        const key = `${row.class_id}:${row.subject}`
        const existing = summaryMap.get(key) || { total: 0, sum: 0, className: row.class?.name ?? 'Class', last: row.created_at }
        existing.total += 1
        existing.sum += Number(row.score) || 0
        if (row.created_at > existing.last) existing.last = row.created_at
        summaryMap.set(key, existing)
      }

      const summaries: RecordedScoreSummary[] = []
      summaryMap.forEach((val, key) => {
        const [clsId, sub] = key.split(':')
        summaries.push({
          classId: clsId,
          subject: sub,
          className: val.className,
          count: val.total,
          avgScore: Math.round(val.sum / val.total),
          lastUpdated: new Date(val.last).toLocaleDateString(),
        })
      })
      setRecentSummaries(summaries)
      setLoadingRecent(false)
    }
  }

  async function goToScores(targetClassId?: string, targetSubject?: string) {
    const cId = targetClassId || classId
    const sub = targetSubject || subject
    if (!cId || !sub || !activeSession) return
    
    setClassId(cId)
    setSubject(sub)
    setSearchQuery('')

    const [studentsRes, scoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', cId).eq('is_active', true).order('full_name'),
      supabase
        .from('exam_scores')
        .select('student_id, score')
        .eq('exam_session_id', activeSession.id)
        .eq('class_id', cId)
        .eq('subject', sub),
    ])

    setStudents(studentsRes.data ?? [])
    const map: Record<string, string> = {}
    for (const row of scoresRes.data ?? []) map[row.student_id] = String(row.score)
    setScores(map)
    setView('scores')
  }

  function handleScoreChange(studentId: string, raw: string) {
    if (raw === '') {
      setScores((prev) => ({ ...prev, [studentId]: '' }))
      return
    }
    let num = Number(raw)
    if (isNaN(num)) return
    if (num < 0) num = 0
    if (num > 100) num = 100
    setScores((prev) => ({ ...prev, [studentId]: String(num) }))
  }

  async function saveScores() {
    if (!profile || !activeSession) return
    setSaving(true)

    const rows = students
      .filter((s) => scores[s.id] !== undefined && scores[s.id] !== '')
      .map((s) => ({
        exam_session_id: activeSession.id,
        class_id: classId,
        subject,
        student_id: s.id,
        score: Number(scores[s.id]),
        recorded_by: profile.id,
      }))

    if (rows.length === 0) {
      setSaving(false)
      setToast({ type: 'error', message: 'Enter at least one score first.' })
      return
    }

    const { error } = await supabase
      .from('exam_scores')
      .upsert(rows, { onConflict: 'exam_session_id,class_id,subject,student_id' })

    setSaving(false)
    setToast(error ? { type: 'error', message: error.message } : { type: 'success', message: 'Scores saved successfully!' })
  }

  const activeContext = useMemo(() => contexts.find((c) => c.classId === classId) ?? null, [contexts, classId])

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => s.full_name.toLowerCase().includes(q))
  }, [students, searchQuery])

  const enteredCount = students.filter((s) => scores[s.id] !== undefined && scores[s.id] !== '').length

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-royal-600">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm font-medium">Loading exams...</span>
        </div>
      </div>
    )
  }

  // ---------- HOME ----------
  if (view === 'home') {
    return (
      <div className="space-y-6 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-[#2541b2] p-8 text-white shadow-xl">
          <div className="absolute top-0 left-0 right-0 pointer-events-none opacity-90">
            <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-full h-12 text-[#FFD700] fill-current">
              <path d="M0,0 C150,80 350,-20 500,30 C650,90 900,10 1200,40 L1200,0 L0,0 Z"></path>
            </svg>
          </div>

          <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
            <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-full h-14 text-[#FFD700] fill-current">
              <path d="M0,40 C250,90 400,10 600,50 C800,90 1000,10 1200,40 L1200,120 L0,120 Z"></path>
            </svg>
          </div>

          <div className="relative z-10 py-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight drop-shadow-sm text-white">Examination Portals</h1>
            <p className="mt-2 text-sm text-blue-100 font-medium max-w-xl">
              Select an active examination window below to begin entering or updating student scores seamlessly.
            </p>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-royal-50 text-royal-600">
              <CalendarClock className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-semibold text-gray-900">No active exams open</h3>
            <p className="mt-1 text-sm text-gray-500">There are currently no examination windows open for score entry.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s)}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-royal-400 hover:shadow-xl"
              >
                <div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-royal-50 transition-transform group-hover:scale-125" />
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full bg-royal-50 px-3 py-1 text-xs font-bold text-royal-700">
                      {s.term}
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-royal-600 text-white transition-transform group-hover:scale-110 shadow-sm">
                      <CalendarClock className="h-4 w-4" />
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-gray-900 tracking-tight">{s.exam_type}</h3>
                </div>
                <div className="mt-6 border-t border-gray-100 pt-4 flex items-center justify-between text-xs text-gray-500 font-medium">
                  <span>Submission Deadline</span>
                  <span className="font-semibold text-royal-700">{new Date(s.end_date).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------- PICK CLASS + SUBJECT (WITH TWO CARDS: ENTER SCORES & RECENT SCORES) ----------
  if (view === 'pick-context') {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-20">
        <button
          onClick={() => setView('home')}
          className="group inline-flex items-center gap-2 text-sm font-semibold text-royal-600 transition-colors hover:text-royal-800"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Back to Exams
        </button>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{activeSession?.exam_type}</h1>
          <p className="mt-1 text-sm text-gray-500">{activeSession?.term} Examination Portal</p>

          <div className="mt-6 grid grid-cols-2 gap-3 border-b border-gray-100 pb-6">
            <button
              onClick={() => setSubTab('enter')}
              className={`flex items-center gap-3 rounded-xl p-4 text-left transition-all border ${
                subTab === 'enter'
                  ? 'border-royal-500 bg-royal-50/60 shadow-sm ring-2 ring-royal-100'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className={`rounded-lg p-2.5 ${subTab === 'enter' ? 'bg-royal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <FileEdit className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm">Enter Scores</p>
                <p className="text-xs text-gray-500 mt-0.5">Input & update marks</p>
              </div>
            </button>

            <button
              onClick={() => setSubTab('recent')}
              className={`flex items-center gap-3 rounded-xl p-4 text-left transition-all border ${
                subTab === 'recent'
                  ? 'border-royal-500 bg-royal-50/60 shadow-sm ring-2 ring-royal-100'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className={`rounded-lg p-2.5 ${subTab === 'recent' ? 'bg-royal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <History className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm">Recent Scores</p>
                <p className="text-xs text-gray-500 mt-0.5">View recorded entries</p>
              </div>
            </button>
          </div>

          {subTab === 'enter' && (
            <div className="mt-6 space-y-5 animate-in fade-in">
              {contextsForSession.length > 1 ? (
                <div>
                  <label className="block text-sm font-semibold text-gray-900">Select Class</label>
                  <select
                    value={classId}
                    onChange={(e) => {
                      setClassId(e.target.value)
                      const ctx = contextsForSession.find((c) => c.classId === e.target.value)
                      setSubject(ctx?.subjects[0] ?? '')
                    }}
                    className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 outline-none transition focus:border-royal-500 focus:ring-4 focus:ring-royal-100"
                  >
                    {contextsForSession.map((c) => (
                      <option key={c.classId} value={c.classId}>
                        {c.className}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Class</label>
                  <div className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-royal-200 bg-royal-50/50 px-4 py-3">
                    <GraduationCap className="h-5 w-5 text-royal-600" />
                    <span className="text-sm font-bold text-gray-900">{activeContext?.className}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-900">Select Subject</label>
                {activeContext && activeContext.subjects.length === 0 ? (
                  <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                    No subjects are currently assigned to you for this class level. Please contact your administrator.
                  </div>
                ) : (
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 outline-none transition focus:border-royal-500 focus:ring-4 focus:ring-royal-100"
                  >
                    {activeContext?.subjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                onClick={() => goToScores()}
                disabled={!subject || (activeContext?.subjects.length ?? 0) === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-bold text-white shadow-md transition hover:bg-royal-700 hover:shadow-lg disabled:opacity-60"
              >
                <BookOpen className="h-4 w-4" />
                Proceed to Enter Scores
              </button>
            </div>
          )}

          {subTab === 'recent' && (
            <div className="mt-6 space-y-4 animate-in fade-in">
              <h3 className="text-sm font-semibold text-gray-700">Summary of Scores You Recorded (Click to Edit)</h3>
              {loadingRecent ? (
                <p className="text-xs text-gray-400 py-6 text-center">Loading recent entries...</p>
              ) : recentSummaries.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-8 text-center text-xs text-gray-500">
                  No scores recorded for this exam session yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSummaries.map((sum, i) => (
                    <button
                      key={i}
                      onClick={() => goToScores(sum.classId, sum.subject)}
                      className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-royal-400 hover:shadow-md text-left group"
                    >
                      <div>
                        <p className="text-sm font-bold text-gray-900 group-hover:text-royal-600 transition-colors">{sum.subject}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{sum.className} • Updated {sum.lastUpdated}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="inline-flex items-center rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">
                            {sum.count} students
                          </span>
                          <p className="text-xs text-gray-400 mt-1">Avg: {sum.avgScore} marks</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-royal-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- SCORES TABLE ----------
  return (
    <div className="space-y-6 pb-28">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          onClick={() => setView('pick-context')}
          className="group inline-flex items-center gap-2 text-sm font-semibold text-royal-600 transition-colors hover:text-royal-800"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Back to Selection
        </button>

        <div className="flex items-center gap-2.5 rounded-full bg-white px-4 py-1.5 shadow-sm border border-gray-200 w-fit">
          <span className="text-xs font-semibold text-gray-500">Progress:</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
              enteredCount === students.length && students.length > 0
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {enteredCount} / {students.length} entered
          </span>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm border border-gray-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">{activeSession?.exam_type}</h1>
              <span className="rounded-lg bg-royal-50 px-2 py-0.5 text-xs font-bold text-royal-700">/100 marks</span>
            </div>
            <p className="mt-1 text-xs sm:text-sm font-medium text-gray-500">
              {subject} <span className="text-royal-400 mx-1">•</span> {activeContext?.className} <span className="text-royal-400 mx-1">•</span> {activeSession?.term}
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search student by name..."
              className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-royal-500 focus:ring-4 focus:ring-royal-100"
            />
          </div>
        </div>

        <div className="mt-6">
          {filteredStudents.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-12 text-center text-gray-400 text-sm">
              {students.length === 0 ? 'No active students found in this class.' : 'No students match your search query.'}
            </div>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="space-y-3 sm:hidden">
                {filteredStudents.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900">{s.full_name}</p>
                        <p className="text-[11px] text-gray-400">{s.admission_number || 'No ID'}</p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        value={scores[s.id] ?? ''}
                        onChange={(e) => handleScoreChange(s.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault()
                        }}
                        placeholder="—"
                        className={`w-20 rounded-xl border px-3 py-2 text-center text-sm font-bold outline-none transition shadow-sm focus:ring-4 ${scoreInputClasses(
                          scores[s.id]
                        )}`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View: Table */}
              <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase font-semibold text-gray-500 tracking-wider border-b border-gray-200">
                    <tr>
                      <th className="w-16 px-6 py-3.5">SN</th>
                      <th className="px-6 py-3.5">Student Name</th>
                      <th className="w-44 px-6 py-3.5 text-right">Score (/100)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.map((s, i) => (
                      <tr key={s.id} className="transition-colors hover:bg-royal-50/30">
                        <td className="px-6 py-4 font-medium text-gray-400">{i + 1}</td>
                        <td className="px-6 py-4 font-semibold text-gray-900">{s.full_name}</td>
                        <td className="px-6 py-4 text-right">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            value={scores[s.id] ?? ''}
                            onChange={(e) => handleScoreChange(s.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault()
                            }}
                            placeholder="—"
                            className={`w-28 rounded-xl border px-3 py-2 text-center text-sm font-bold outline-none transition shadow-sm focus:ring-4 ${scoreInputClasses(
                              scores[s.id]
                            )}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {students.length > 0 && (
          <div className="sticky bottom-20 sm:bottom-6 mt-6 flex items-center justify-end rounded-2xl bg-white/90 backdrop-blur-md p-4 border border-gray-200 shadow-xl z-20">
            <button
              onClick={saveScores}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-royal-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-royal-700 hover:shadow-xl disabled:opacity-60 w-full sm:w-auto justify-center"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save All Scores'}
            </button>
          </div>
        )}
      </div>

      {saving && <SavingOverlay />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}