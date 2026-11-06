import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  session: { id: string; academic_year: string }
  onBack: () => void
}

interface ClassRow {
  id: string
  name: string
}
interface Student {
  id: string
  full_name: string
  admission_number: string | null
}
interface ScoreRow {
  student_id: string
  subject: string
  year1_score: number | null
  year2_score: number | null
}

const isBasic9 = (n: string) => /(basic|class|b)\s*-?\s*9\b/i.test(n)
const show = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(n)))

export default function AdminCassScores({ session, onBack }: Props) {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [classId, setClassId] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [teachers, setTeachers] = useState<Record<string, string[]>>({})
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'subject' | 'student'>('subject')
  const [subject, setSubject] = useState('')
  const [studentId, setStudentId] = useState('')
  const [q, setQ] = useState('')

  // Basic 9 class(es)
  useEffect(() => {
    supabase
      .from('classes')
      .select('id, name')
      .eq('level_group', 'jhs')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const list = ((data ?? []) as ClassRow[]).filter((c) => isBasic9(c.name))
        setClasses(list)
        setClassId(list[0]?.id ?? '')
        if (list.length === 0) setLoading(false)
      })
  }, [])

  // Students, subjects, teachers and scores for the chosen class
  useEffect(() => {
    if (!classId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const [stuRes, subRes, asgRes, scoreRes] = await Promise.all([
        supabase.from('students').select('id, full_name, admission_number').eq('class_id', classId).eq('is_active', true).order('full_name'),
        supabase.from('subjects').select('name').eq('level_group', 'jhs').order('name'),
        supabase.from('subject_assignments').select('subject, teacher_id').eq('class_id', classId),
        supabase
          .from('cass_scores')
          .select('student_id, subject, year1_score, year2_score')
          .eq('cass_session_id', session.id)
          .eq('class_id', classId),
      ])
      if (cancelled) return
      const err = stuRes.error ?? scoreRes.error ?? asgRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const asg = (asgRes.data ?? []) as { subject: string; teacher_id: string }[]
      const ids = Array.from(new Set(asg.map((a) => a.teacher_id)))
      const names: Record<string, string> = {}
      if (ids.length) {
        const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        for (const p of (data ?? []) as { id: string; full_name: string | null }[]) names[p.id] = p.full_name ?? 'Teacher'
      }
      const byTeacher: Record<string, string[]> = {}
      for (const a of asg) (byTeacher[a.subject] ??= []).push(names[a.teacher_id] ?? 'Teacher')

      const sc = (scoreRes.data ?? []) as ScoreRow[]
      // The Subjects page is the single source of truth: renamed/removed subjects must not linger here
      const list = Array.from(new Set(((subRes.data ?? []) as { name: string }[]).map((s) => s.name))).sort((a, b) => a.localeCompare(b))
      const current = new Set(list)
      for (const k of Object.keys(byTeacher)) if (!current.has(k)) delete byTeacher[k]

      setStudents((stuRes.data ?? []) as Student[])
      setScores(sc)
      setTeachers(byTeacher)
      setSubjects(list)
      setSubject((cur) => (cur && list.includes(cur) ? cur : (list[0] ?? '')))
      setStudentId((cur) => cur || ((stuRes.data ?? [])[0] as Student | undefined)?.id || '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [classId, session.id])

  const lookup = useMemo(() => {
    const m = new Map<string, ScoreRow>()
    for (const s of scores) m.set(`${s.subject}|${s.student_id}`, s)
    return m
  }, [scores])

  const progress = (sub: string) => {
    let done = 0
    for (const st of students) {
      const r = lookup.get(`${sub}|${st.id}`)
      if (r && r.year1_score !== null && r.year2_score !== null) done++
    }
    return done
  }

  const filteredStudents = students.filter((s) => s.full_name.toLowerCase().includes(q.trim().toLowerCase()))
  const student = students.find((s) => s.id === studentId)

  // Same subject order as the official CASS sheet; anything not listed goes last, A to Z
  const orderedSubjects = useMemo(() => {
    const ORDER = [/english/i, /dangme|\bga\b|ewe|twi|fante|ghanaian language/i, /social/i, /religious|\br\.?m\.?e\b/i, /math/i, /science/i, /career/i, /creative|\bcad\b/i, /comput|\bict\b/i]
    const rank = (n: string) => {
      const i = ORDER.findIndex((re) => re.test(n))
      return i === -1 ? ORDER.length : i
    }
    return [...subjects].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  }, [subjects])

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="mt-2 text-2xl font-bold text-royal-900">CASS {session.academic_year}</h1>
      <p className="text-sm text-gray-500">Scores entered by the subject teachers (view only).</p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!loading && classes.length === 0 && !error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">No Basic 9 class found.</p>
      )}

      {classes.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setClassId(c.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                c.id === classId ? 'border-royal-600 bg-royal-600 text-white' : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mt-5 h-40 animate-pulse rounded-2xl bg-gray-100" />
      ) : classId ? (
        <>
          <div className="mt-5 inline-flex rounded-xl bg-gray-100 p-1">
            {(
              [
                ['subject', 'By subject'],
                ['student', 'By student'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === k ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'subject' ? (
            <>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {subjects.map((s) => {
                  const done = progress(s)
                  const pct = students.length ? Math.round((done / students.length) * 100) : 0
                  return (
                    <button
                      key={s}
                      onClick={() => setSubject(s)}
                      className={`rounded-xl border p-3 text-left transition ${
                        s === subject ? 'border-royal-500 bg-royal-50' : 'border-gray-200 bg-white hover:border-royal-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-royal-900">{s}</p>
                        <span className="shrink-0 text-xs font-bold text-gray-500">
                          {done}/{students.length}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-gray-400">{teachers[s]?.join(', ') ?? 'No teacher assigned'}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-royal-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </button>
                  )
                })}
              </div>

              {subject && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-royal-900">{subject}</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="w-10 px-4 py-2">#</th>
                        <th className="px-2 py-2">Student</th>
                        <th className="w-28 px-2 py-2 text-center">Year 1</th>
                        <th className="w-28 px-2 py-2 text-center">Year 2</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {students.map((st, i) => {
                        const r = lookup.get(`${subject}|${st.id}`)
                        return (
                          <tr key={st.id}>
                            <td className="px-4 py-2 text-xs text-gray-400">{i + 1}</td>
                            <td className="px-2 py-2 font-medium text-royal-900">{st.full_name}</td>
                            <td className="px-2 py-2 text-center">{show(r?.year1_score) || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-2 text-center">{show(r?.year2_score) || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search student"
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-royal-500"
                  />
                </div>
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-royal-500 sm:max-w-xs"
                >
                  {filteredStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {student && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="text-sm text-gray-500">
                      Student Code: <span className="font-semibold text-royal-900">{student.admission_number ?? '—'}</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      Full Name: <span className="font-semibold text-royal-900">{student.full_name}</span>
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-2">Subject</th>
                        <th className="w-32 px-2 py-2 text-center">Year 1 Cass Score</th>
                        <th className="w-32 px-2 py-2 text-center">Year 2 Cass Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {orderedSubjects.map((s) => {
                        const r = lookup.get(`${s}|${student.id}`)
                        return (
                          <tr key={s}>
                            <td className="px-4 py-2 font-medium uppercase text-royal-900">{s}</td>
                            <td className="px-2 py-2 text-center">{show(r?.year1_score) || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-2 text-center">{show(r?.year2_score) || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
