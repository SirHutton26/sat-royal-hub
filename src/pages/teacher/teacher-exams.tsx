import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Save,
  Search,
  CheckCircle2,
  AlertCircle,
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

type View = 'home' | 'pick-context' | 'scores'
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
  if (!score) return 'border-gray-300 focus:border-royal-500 focus:ring-royal-100'
  const num = Number(score)
  if (isNaN(num)) return 'border-gray-300 focus:border-royal-500 focus:ring-royal-100'
  if (num < 50) return 'border-red-400 bg-red-50 text-red-700 focus:ring-red-100'
  if (num < 80) return 'border-amber-400 bg-amber-50 text-amber-700 focus:ring-amber-100'
  return 'border-green-400 bg-green-50 text-green-700 focus:ring-green-100'
}

function SavingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-royal-900/40 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-royal-400 border-t-transparent" />
        <img src={schoolLogo} alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1" />
      </div>
      <p className="mt-4 text-sm font-medium text-white">Saving scores...</p>
    </div>
  )
}

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
        className={`flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        } text-white`}
      >
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        <p className="text-sm font-medium">{toast.message}</p>
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

  const [activeSession, setActiveSession] = useState<ExamSession | null>(null)
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')

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
      if (myClassRes.data.level_group) {
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

  function openSession(session: ExamSession) {
    setActiveSession(session)
    setToast(null)
    setSearchQuery('')
    const matches = contexts.filter((c) => toExamGroupKey(c.levelGroup) === session.group_key)
    setClassId(matches[0]?.classId ?? '')
    setSubject(matches[0]?.subjects[0] ?? '')
    setView('pick-context')
  }

  async function goToScores() {
    if (!classId || !subject || !activeSession) return
    setSearchQuery('')

    const [studentsRes, scoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', classId).eq('is_active', true).order('full_name'),
      supabase
        .from('exam_scores')
        .select('student_id, score')
        .eq('exam_session_id', activeSession.id)
        .eq('class_id', classId)
        .eq('subject', subject),
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

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  // ---------- HOME ----------
  if (view === 'home') {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">Exams</h1>
        <p className="mt-1 text-sm text-gray-500">Exam types your administrator has opened for entry.</p>

        {sessions.length === 0 ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <CalendarClock className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No exams are currently open for score entry.</p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s)}
                className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-royal-900">{s.exam_type}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{s.term}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Open until {new Date(s.end_date).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------- PICK CLASS + SUBJECT ----------
  if (view === 'pick-context') {
    return (
      <div>
        <button onClick={() => setView('home')} className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mt-2 text-xl font-semibold text-royal-900">
          {activeSession?.exam_type} · {activeSession?.term}
        </h1>

        <div className="mt-4 max-w-sm space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {contextsForSession.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-royal-900">Class</label>
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value)
                  const ctx = contextsForSession.find((c) => c.classId === e.target.value)
                  setSubject(ctx?.subjects[0] ?? '')
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              >
                {contextsForSession.map((c) => (
                  <option key={c.classId} value={c.classId}>
                    {c.className}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-royal-900">Subject</label>
            {activeContext && activeContext.subjects.length === 0 ? (
              <p className="mt-1 text-xs text-red-500">
                No subjects set up for this class's level yet. Ask your administrator to add them.
              </p>
            ) : (
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
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
            onClick={goToScores}
            disabled={!subject}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            Next: Enter scores
          </button>
        </div>
      </div>
    )
  }

  // ---------- SCORES ----------
  return (
    <div>
      <button onClick={() => setView('pick-context')} className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-royal-900">
            {activeSession?.exam_type} <span className="text-sm font-normal text-gray-400">/100</span>
          </h1>
          <p className="text-sm text-gray-500">
            {subject} · {activeContext?.className || ''} · {activeSession?.term}
          </p>
        </div>
        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ${
            enteredCount === students.length && students.length > 0
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {enteredCount}/{students.length} entered
        </span>
      </div>

      <div className="relative mt-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name"
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="w-14 px-4 py-3">SN</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  {students.length === 0 ? 'No students in this class.' : 'No students match your search.'}
                </td>
              </tr>
            ) : (
              filteredStudents.map((s, i) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-royal-900">{s.full_name}</td>
                  <td className="px-4 py-3">
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
                      className={`w-20 rounded-md border px-2 py-1.5 text-sm font-semibold outline-none transition focus:ring-2 ${scoreInputClasses(
                        scores[s.id]
                      )}`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {students.length > 0 && (
        <div className="sticky bottom-24 mt-4 flex items-center justify-end rounded-xl bg-white p-3 shadow-lg md:bottom-4">
          <button
            onClick={saveScores}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            Save scores
          </button>
        </div>
      )}

      {saving && <SavingOverlay />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}