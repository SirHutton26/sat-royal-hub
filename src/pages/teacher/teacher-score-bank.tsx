import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Plus,
  BookOpen,
  ChevronRight,
  Save,
  Search,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const TERMS = ['Term 1', 'Term 2', 'Term 3']

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

type View = 'home' | 'pick-context' | 'set-total' | 'scores'
type ToastState = { type: 'success' | 'error'; message: string } | null

function scoreInputClasses(score: string | undefined, total: number) {
  if (!score) return 'border-gray-300 focus:border-royal-500 focus:ring-royal-100'
  const num = Number(score)
  if (isNaN(num) || total <= 0) return 'border-gray-300 focus:border-royal-500 focus:ring-royal-100'
  const pct = (num / total) * 100
  if (pct < 50) return 'border-red-400 bg-red-50 text-red-700 focus:ring-red-100'
  if (pct < 80) return 'border-amber-400 bg-amber-50 text-amber-700 focus:ring-amber-100'
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

export default function TeacherScoreBank() {
  const { profile } = useAuth()
  const [contexts, setContexts] = useState<TeachingContext[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('home')

  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState(TERMS[0])
  const [title, setTitle] = useState('')
  const [totalScore, setTotalScore] = useState('')
  const [entryId, setEntryId] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [entryToDelete, setEntryToDelete] = useState<RecentEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  async function loadRecent() {
    if (!profile) return
    const { data } = await supabase
      .from('score_bank_entries')
      .select('id, class_id, title, subject, term, total_score, created_at, class:classes(name)')
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
    setRecent((data as unknown as RecentEntry[]) ?? [])
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

  function startCreate() {
    setEntryId(null)
    setClassId(contexts[0]?.classId ?? '')
    setSubject(contexts[0]?.subjects[0] ?? '')
    setTerm(TERMS[0])
    setTitle('')
    setTotalScore('')
    setMessage(null)
    setSearchQuery('')
    setView('pick-context')
  }

  function goToTotal() {
    if (!classId || !subject) return
    setView('set-total')
  }

  async function goToScores() {
    if (!title.trim()) {
      setMessage('Enter a title, e.g. Task 1, Quiz 1, Class Test.')
      return
    }
    if (!totalScore || Number(totalScore) <= 0) {
      setMessage('Enter a valid total score.')
      return
    }
    setMessage(null)
    setSearchQuery('')
    const { data } = await supabase
      .from('students')
      .select('id, full_name, admission_number')
      .eq('class_id', classId)
      .eq('is_active', true)
      .order('full_name')
    setStudents(data ?? [])
    setScores({})
    setView('scores')
  }

  async function openExisting(entry: RecentEntry) {
    setMessage(null)
    setSearchQuery('')
    setEntryId(entry.id)
    setTitle(entry.title)
    setSubject(entry.subject)
    setTerm(entry.term)
    setTotalScore(String(entry.total_score))

    const cId = entry.class_id
    setClassId(cId)

    const [studentsRes, scoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', cId).eq('is_active', true).order('full_name'),
      supabase.from('score_bank_scores').select('student_id, score').eq('entry_id', entry.id),
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
    const max = Number(totalScore) || 0
    if (num < 0) num = 0
    if (max > 0 && num > max) num = max
    setScores((prev) => ({ ...prev, [studentId]: String(num) }))
  }

  async function saveEntry() {
    if (!profile) return
    setSaving(true)

    let currentEntryId = entryId

    if (!currentEntryId) {
      const { data, error } = await supabase
        .from('score_bank_entries')
        .insert({
          class_id: classId,
          subject,
          term,
          title: title.trim(),
          total_score: Number(totalScore),
          teacher_id: profile.id,
        })
        .select('id')
        .single()
      if (error || !data) {
        setSaving(false)
        setToast({ type: 'error', message: error?.message ?? 'Could not create the entry.' })
        return
      }
      currentEntryId = data.id
      setEntryId(currentEntryId)
    }

    const rows = students
      .filter((s) => scores[s.id] !== undefined && scores[s.id] !== '')
      .map((s) => ({ entry_id: currentEntryId, student_id: s.id, score: Number(scores[s.id]) }))

    if (rows.length > 0) {
      const { error } = await supabase.from('score_bank_scores').upsert(rows, { onConflict: 'entry_id,student_id' })
      if (error) {
        setSaving(false)
        setToast({ type: 'error', message: error.message })
        return
      }
    }

    setSaving(false)
    setToast({ type: 'success', message: 'Score entry saved successfully!' })
    await loadRecent()
  }

  async function confirmDelete() {
    if (!entryToDelete) return
    setDeleting(true)

    // Remove child scores first (safe even if you have ON DELETE CASCADE)
    const { error: scoresError } = await supabase
      .from('score_bank_scores')
      .delete()
      .eq('entry_id', entryToDelete.id)

    if (scoresError) {
      setDeleting(false)
      setToast({ type: 'error', message: scoresError.message })
      return
    }

    const { data, error } = await supabase
      .from('score_bank_entries')
      .delete()
      .eq('id', entryToDelete.id)
      .select('id')

    setDeleting(false)

    if (error || !data || data.length === 0) {
      setToast({ type: 'error', message: error?.message ?? 'Could not delete this entry.' })
      return
    }

    setRecent((prev) => prev.filter((e) => e.id !== entryToDelete.id))
    setEntryToDelete(null)
    setToast({ type: 'success', message: 'Score entry deleted.' })
  }

  const activeContext = useMemo(() => contexts.find((c) => c.classId === classId) ?? null, [contexts, classId])

  const subjectGroups = useMemo<SubjectGroup[]>(() => {
    const map = new Map<string, SubjectGroup>()
    for (const e of recent) {
      const key = `${e.class_id}|${e.subject}`
      const group = map.get(key)
      if (group) group.entries.push(e)
      else map.set(key, { key, subject: e.subject, className: e.class?.name ?? '', entries: [e] })
    }
    return Array.from(map.values()).sort((a, b) => a.subject.localeCompare(b.subject))
  }, [recent])

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => s.full_name.toLowerCase().includes(q))
  }, [students, searchQuery])

  const enteredCount = students.filter((s) => scores[s.id] !== undefined && scores[s.id] !== '').length

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  if (view === 'home') {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">Score Bank</h1>
        <p className="mt-1 text-sm text-gray-500">Tasks, quizzes, tests and group work — all feed into SBA later.</p>

        <button
          onClick={startCreate}
          disabled={contexts.length === 0}
          className="mt-4 flex w-full items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md disabled:opacity-50 sm:max-w-sm"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-royal-600 text-white">
            <Plus className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-royal-900">Add Score Entry</p>
            <p className="mt-0.5 text-xs text-gray-500">Pick a subject, title it, enter scores</p>
          </div>
        </button>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Your Subjects</h2>

        {subjectGroups.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No entries yet. Add a score entry to see its subject here.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjectGroups.map((group) => (
              <div key={group.key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-royal-900">{group.subject}</p>
                      <p className="text-xs text-gray-500">{group.className}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-royal-50 px-2.5 py-1 text-xs font-bold text-royal-700">
                    {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {group.entries.map((e) => (
                    <div key={e.id} className="flex items-center gap-1 rounded-lg bg-gray-50 transition hover:bg-royal-50">
                      <button
                        onClick={() => openExisting(e)}
                        className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-royal-900">{e.title}</p>
                          <p className="text-xs text-gray-500">
                            {e.term} · /{e.total_score}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                      </button>
                      <button
                        onClick={() => setEntryToDelete(e)}
                        aria-label={`Delete ${e.title}`}
                        className="mr-1 rounded-md p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {contexts.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">
            You don't have a class or subject assignment yet, so the Score Bank isn't available.
          </p>
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
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )
  }

  if (view === 'pick-context') {
    return (
      <div>
        <button onClick={() => setView('home')} className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mt-2 text-xl font-semibold text-royal-900">New score entry</h1>

        <div className="mt-4 max-w-sm space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {contexts.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-royal-900">Class</label>
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value)
                  const ctx = contexts.find((c) => c.classId === e.target.value)
                  setSubject(ctx?.subjects[0] ?? '')
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              >
                {contexts.map((c) => (
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

          <div>
            <label className="block text-sm font-medium text-royal-900">Term</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={goToTotal}
            disabled={!subject}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            Next
          </button>
        </div>
      </div>
    )
  }

  if (view === 'set-total') {
    return (
      <div>
        <button onClick={() => setView('pick-context')} className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mt-2 text-xl font-semibold text-royal-900">
          {subject} · {activeContext?.className}
        </h1>

        <div className="mt-4 max-w-sm space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-royal-900">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Task 1, Quiz 1, Class Test"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-royal-900">Total score</label>
            <input
              type="number"
              min={1}
              value={totalScore}
              onChange={(e) => setTotalScore(e.target.value)}
              placeholder="e.g. 15"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
          </div>
          {message && <p className="text-sm text-red-600">{message}</p>}
          <button
            onClick={goToScores}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700"
          >
            Next: Enter scores
          </button>
        </div>
      </div>
    )
  }

  const total = Number(totalScore) || 0

  return (
    <div>
      <button
        onClick={() => setView(entryId ? 'home' : 'set-total')}
        className="flex items-center gap-1 text-sm text-royal-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-royal-900">
            {title} <span className="text-sm font-normal text-gray-400">/{totalScore}</span>
          </h1>
          <p className="text-sm text-gray-500">
            {subject} · {activeContext?.className || ''} · {term}
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
                      max={total || undefined}
                      value={scores[s.id] ?? ''}
                      onChange={(e) => handleScoreChange(s.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault()
                      }}
                      placeholder="—"
                      className={`w-20 rounded-md border px-2 py-1.5 text-sm font-semibold outline-none transition focus:ring-2 ${scoreInputClasses(
                        scores[s.id],
                        total
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
            onClick={saveEntry}
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