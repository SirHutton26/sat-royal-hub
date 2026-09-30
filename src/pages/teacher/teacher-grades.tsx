import { useEffect, useMemo, useState } from 'react'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

interface Student {
  id: string
  full_name: string
  admission_number: string
}

interface TeachingContext {
  classId: string
  className: string
  subjects: string[] | null // null = free-text subject allowed (own/homeroom class)
}

const TERMS = ['Term 1', 'Term 2', 'Term 3']

export default function TeacherGrades() {
  const { profile } = useAuth()
  const [contexts, setContexts] = useState<TeachingContext[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState(TERMS[0])
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [loadingContexts, setLoadingContexts] = useState(true)
  const [loadingScores, setLoadingScores] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Build the list of classes/subjects this teacher may grade
  useEffect(() => {
    let active = true
    async function loadContexts() {
      if (!profile) return
      const [myClassRes, assignmentsRes] = await Promise.all([
        supabase.from('classes').select('id, name').eq('teacher_id', profile.id).maybeSingle(),
        supabase
          .from('subject_assignments')
          .select('subject, class_id, class:classes(name)')
          .eq('teacher_id', profile.id),
      ])
      if (!active) return

      const map = new Map<string, TeachingContext>()

      if (myClassRes.data) {
        map.set(myClassRes.data.id, {
          classId: myClassRes.data.id,
          className: myClassRes.data.name,
          subjects: null,
        })
      }

      for (const row of (assignmentsRes.data as unknown as {
        subject: string
        class_id: string
        class: { name: string } | null
      }[]) ?? []) {
        const existing = map.get(row.class_id)
        if (existing) {
          if (existing.subjects) existing.subjects.push(row.subject)
        } else {
          map.set(row.class_id, {
            classId: row.class_id,
            className: row.class?.name ?? '',
            subjects: [row.subject],
          })
        }
      }

      const list = Array.from(map.values())
      setContexts(list)
      if (list.length > 0) {
        setSelectedClassId(list[0].classId)
        setSubject(list[0].subjects ? list[0].subjects[0] : '')
      }
      setLoadingContexts(false)
    }
    loadContexts()
    return () => {
      active = false
    }
  }, [profile])

  const activeContext = useMemo(
    () => contexts.find((c) => c.classId === selectedClassId) ?? null,
    [contexts, selectedClassId]
  )

  // When the selected class changes, default the subject
  useEffect(() => {
    if (!activeContext) return
    setSubject(activeContext.subjects ? activeContext.subjects[0] ?? '' : '')
  }, [activeContext])

  // Load students for the selected class
  useEffect(() => {
    let active = true
    async function loadStudents() {
      if (!selectedClassId) {
        setStudents([])
        return
      }
      const { data } = await supabase
        .from('students')
        .select('id, full_name, admission_number')
        .eq('class_id', selectedClassId)
        .eq('is_active', true)
        .order('full_name')
      if (active) setStudents(data ?? [])
    }
    loadStudents()
    return () => {
      active = false
    }
  }, [selectedClassId])

  // Load existing scores for class + subject + term
  useEffect(() => {
    let active = true
    async function loadScores() {
      if (!selectedClassId || !subject.trim()) {
        setScores({})
        return
      }
      setLoadingScores(true)
      const { data } = await supabase
        .from('grades')
        .select('student_id, score')
        .eq('class_id', selectedClassId)
        .eq('subject', subject.trim())
        .eq('term', term)
      if (!active) return
      const map: Record<string, string> = {}
      for (const row of data ?? []) map[row.student_id] = String(row.score)
      setScores(map)
      setLoadingScores(false)
    }
    loadScores()
    return () => {
      active = false
    }
  }, [selectedClassId, subject, term])

  function setScore(studentId: string, value: string) {
    setScores((prev) => ({ ...prev, [studentId]: value }))
  }

  async function saveGrades() {
    if (!selectedClassId || !profile || !subject.trim()) return
    setSaving(true)
    setSavedMsg(null)

    const rows = students
      .filter((s) => scores[s.id] !== undefined && scores[s.id] !== '')
      .map((s) => ({
        class_id: selectedClassId,
        student_id: s.id,
        subject: subject.trim(),
        term,
        score: Number(scores[s.id]),
        recorded_by: profile.id,
      }))

    if (rows.length === 0) {
      setSaving(false)
      setSavedMsg('Enter at least one score first.')
      return
    }

    const { error } = await supabase.from('grades').upsert(rows, { onConflict: 'student_id,subject,term' })
    setSaving(false)
    setSavedMsg(error ? error.message : 'Grades saved.')
  }

  if (loadingContexts) {
    return <p className="text-sm text-gray-400">Loading...</p>
  }

  if (contexts.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">Grades</h1>
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            You don't have a class or subject assignment yet. Contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Grades</h1>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {contexts.length > 1 && (
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          >
            {contexts.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.className}
              </option>
            ))}
          </select>
        )}

        {activeContext?.subjects ? (
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          >
            {activeContext.subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject, e.g. Mathematics"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
        )}

        <select
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        >
          {TERMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {!subject.trim() ? (
        <div className="mt-6 rounded-xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
          Enter a subject to start entering scores.
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Admission #</th>
                  <th className="px-4 py-3">Score (0–100)</th>
                </tr>
              </thead>
              <tbody>
                {loadingScores ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                      No students in this class.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 font-medium text-royal-900">{s.full_name}</td>
                      <td className="px-4 py-3 text-gray-600">{s.admission_number}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={scores[s.id] ?? ''}
                          onChange={(e) => setScore(s.id, e.target.value)}
                          className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {students.length > 0 && (
            <div className="sticky bottom-24 mt-4 flex items-center justify-between rounded-xl bg-white p-3 shadow-lg md:bottom-4">
              {savedMsg && <p className="text-xs text-gray-500">{savedMsg}</p>}
              <button
                onClick={saveGrades}
                disabled={saving}
                className="ml-auto flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save grades'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}