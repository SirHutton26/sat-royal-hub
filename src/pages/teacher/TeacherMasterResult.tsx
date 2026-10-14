import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FilePlus2, History, Download, Eye, AlertCircle, Users, BarChart3, Trophy, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import MasterResultReport from './MasterResultReport'
import { aggregate, orderSubjects } from '@/lib/master-result'

const TERMS = ['Term 1', 'Term 2', 'Term 3']

interface MyClass {
  id: string
  name: string
  level_group: string | null
}

interface Student {
  id: string
  full_name: string
  admission_number: string
}

interface ResultRow {
  student_id: string
  subject: string
  total_score: number | string | null
}

interface MasterRow {
  studentId: string
  name: string
  admission: string
  scores: Record<string, number | null>
  count: number
  complete: boolean
  total: number | null
  average: number | null
  agg: number | null
  grade: string | null
  position: number | null
}

interface RecentTerm {
  term: string
  subjects: number
  exams: string[]
}

type SortMode = 'name' | 'position'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// Same grading scale as the SBA page
function gradeFor(pct: number): string {
  if (pct >= 80) return 'A'
  if (pct >= 68) return 'B'
  if (pct >= 54) return 'C'
  if (pct >= 40) return 'D'
  return 'E'
}

function gradeBadge(grade: string) {
  return grade === 'A'
    ? 'bg-green-600'
    : grade === 'B'
    ? 'bg-sky-600'
    : grade === 'C'
    ? 'bg-amber-500'
    : grade === 'D'
    ? 'bg-orange-500'
    : 'bg-red-600'
}

function gradeText(grade: string) {
  return grade === 'A'
    ? 'text-green-700'
    : grade === 'B'
    ? 'text-sky-700'
    : grade === 'C'
    ? 'text-amber-600'
    : grade === 'D'
    ? 'text-orange-600'
    : 'text-red-600'
}

function ordinal(n: number) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

async function loadSubjectNames(levelGroup: string | null): Promise<string[]> {
  if (!levelGroup) return []
  const { data } = await supabase.from('subjects').select('name').eq('level_group', levelGroup).order('name')
  return (data ?? []).map((s) => s.name)
}

function Tile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="truncate text-base font-bold text-royal-900">{value}</p>
        </div>
      </div>
    </div>
  )
}

export default function TeacherMasterResult() {
  const { profile } = useAuth()
  const [myClass, setMyClass] = useState<MyClass | null>(null)
  const [loadingClass, setLoadingClass] = useState(true)
  const [term, setTerm] = useState(TERMS[0])
  const [sort, setSort] = useState<SortMode>('name')
  const [showReport, setShowReport] = useState(false)
  // landing choice: New Results (current term) or Recent Results (earlier terms that already have results)
  const [view, setView] = useState<'menu' | 'new' | 'recent'>('menu')
  const [currentTerm, setCurrentTerm] = useState(TERMS[0])
  const [recent, setRecent] = useState<RecentTerm[]>([])
  const [examNames, setExamNames] = useState<string[]>([])

  const [students, setStudents] = useState<Student[]>([])
  const [subjectNames, setSubjectNames] = useState<string[]>([])
  const [results, setResults] = useState<ResultRow[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1. Find the class this teacher is in charge of
  useEffect(() => {
    let active = true
    async function loadClass() {
      if (!profile) return
      const { data } = await supabase
        .from('classes')
        .select('id, name, level_group')
        .eq('teacher_id', profile.id)
        .maybeSingle()
      const { data: st } = await supabase.from('school_settings').select('current_term').limit(1).maybeSingle()
      if (!active) return
      if (st?.current_term && TERMS.includes(st.current_term)) {
        setCurrentTerm(st.current_term)
        setTerm(st.current_term)
      }
      setMyClass(data ?? null)
      setLoadingClass(false)
    }
    loadClass()
    return () => {
      active = false
    }
  }, [profile])

  // Earlier terms that already have saved results, with the exam each one was for
  const examNamesFor = async (classId: string, t?: string) => {
    let q = supabase.from('sba_configs').select('term, exam_session_id').eq('class_id', classId)
    if (t) q = q.eq('term', t)
    const { data: cfg } = await q
    const ids = [...new Set((cfg ?? []).map((c) => c.exam_session_id).filter(Boolean))] as string[]
    const { data: sess } = ids.length ? await supabase.from('exam_sessions').select('id, exam_type').in('id', ids) : { data: [] }
    const type = new Map((sess ?? []).map((x) => [x.id, x.exam_type as string]))
    const out = new Map<string, Set<string>>()
    for (const c of cfg ?? []) {
      const n = c.exam_session_id ? type.get(c.exam_session_id) : undefined
      if (n) out.set(c.term, (out.get(c.term) ?? new Set()).add(n))
    }
    return out
  }

  useEffect(() => {
    if (!myClass) return
    let active = true
    void (async () => {
      const [{ data: res }, names] = await Promise.all([
        supabase.from('sba_results').select('term, subject').eq('class_id', myClass.id),
        examNamesFor(myClass.id),
      ])
      if (!active) return
      const byTerm = new Map<string, Set<string>>()
      for (const r of res ?? []) byTerm.set(r.term, (byTerm.get(r.term) ?? new Set()).add(r.subject))
      setRecent(
        [...byTerm.entries()]
          .filter(([t]) => t !== currentTerm)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([t, subs]) => ({ term: t, subjects: subs.size, exams: [...(names.get(t) ?? [])] })),
      )
    })()
    return () => {
      active = false
    }
  }, [myClass, currentTerm])

  useEffect(() => {
    if (!myClass) return
    let active = true
    void examNamesFor(myClass.id, term).then((m) => active && setExamNames([...(m.get(term) ?? [])]))
    return () => {
      active = false
    }
  }, [myClass, term])

  // 2. Load students, subjects and saved SBA results whenever the class or term changes
  useEffect(() => {
    if (!myClass) return
    let active = true

    async function loadData(cls: MyClass) {
      setLoadingData(true)
      setError(null)

      const [studentsRes, names, resultsRes] = await Promise.all([
        supabase
          .from('students')
          .select('id, full_name, admission_number')
          .eq('class_id', cls.id)
          .eq('is_active', true)
          .order('full_name'),
        loadSubjectNames(cls.level_group),
        supabase.from('sba_results').select('student_id, subject, total_score').eq('class_id', cls.id).eq('term', term),
      ])

      if (!active) return

      const failure = studentsRes.error ?? resultsRes.error
      if (failure) setError(failure.message)

      setStudents(studentsRes.data ?? [])
      setSubjectNames(names)
      setResults((resultsRes.data as ResultRow[]) ?? [])
      setLoadingData(false)
    }

    loadData(myClass)
    return () => {
      active = false
    }
  }, [myClass, term])

  const sheet = useMemo(() => {
    const withResults = new Set(results.map((r) => r.subject))
    const subjects = orderSubjects(Array.from(new Set([...subjectNames, ...withResults])))
    // Only subjects that have saved results count towards totals and positions
    const activeSubjects = subjects.filter((s) => withResults.has(s))
    const missingSubjects = subjects.filter((s) => !withResults.has(s))

    const scoreMap = new Map<string, Record<string, number>>()
    for (const r of results) {
      if (r.total_score === null) continue
      const m = scoreMap.get(r.student_id) ?? {}
      m[r.subject] = Number(r.total_score)
      scoreMap.set(r.student_id, m)
    }

    const rows: MasterRow[] = students.map((s) => {
      const mine = scoreMap.get(s.id) ?? {}
      const scores: Record<string, number | null> = {}
      for (const sub of subjects) scores[sub] = mine[sub] ?? null

      const count = activeSubjects.filter((sub) => scores[sub] !== null).length
      const complete = activeSubjects.length > 0 && count === activeSubjects.length
      // a missing result ("—") counts as 0, so every student is totalled and ranked
      const hasAny = activeSubjects.length > 0
      const total = hasAny ? round2(activeSubjects.reduce((sum, sub) => sum + (scores[sub] ?? 0), 0)) : null
      const average = total !== null ? round2(total / activeSubjects.length) : null

      return {
        studentId: s.id,
        name: s.full_name,
        admission: s.admission_number,
        scores,
        count,
        complete,
        total,
        average,
        agg: hasAny ? aggregate(activeSubjects, scores) : null,
        grade: average !== null ? gradeFor(average) : null,
        position: null,
      }
    })

    // Every student is ranked (missing results count as 0); equal totals share a position
    const ranked = rows.filter((r) => r.total !== null).sort((a, b) => (b.total as number) - (a.total as number))
    let lastTotal: number | null = null
    let lastPosition = 0
    ranked.forEach((r, i) => {
      if (r.total !== lastTotal) {
        lastPosition = i + 1
        lastTotal = r.total
      }
      r.position = lastPosition
    })

    const subjectAverages: Record<string, number | null> = {}
    for (const sub of subjects) {
      const vals = rows.map((r) => r.scores[sub]).filter((v): v is number => v !== null)
      subjectAverages[sub] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const completeRows = rows.filter((r) => r.total !== null)
    const classAverage =
      completeRows.length > 0 ? completeRows.reduce((sum, r) => sum + (r.average as number), 0) / completeRows.length : null
    const toppers = rows.filter((r) => r.position === 1).map((r) => r.name)

    return {
      rows,
      subjects,
      activeCount: activeSubjects.length,
      missingSubjects,
      subjectAverages,
      completeCount: rows.filter((r) => r.complete).length,
      classAverage,
      toppers,
    }
  }, [students, subjectNames, results])

  const examLabel = examNames.length ? examNames.join(' & ') : `${term} Exam`

  const displayRows = useMemo(() => {
    if (sort === 'name') return sheet.rows
    return [...sheet.rows].sort((a, b) => {
      if (a.position !== null && b.position !== null) return a.position - b.position || a.name.localeCompare(b.name)
      if (a.position !== null) return -1
      if (b.position !== null) return 1
      return a.name.localeCompare(b.name)
    })
  }, [sheet.rows, sort])

  function downloadCsv() {
    if (!myClass) return
    const header = ['SN', 'Name', 'Admission No', ...sheet.subjects, 'Total', 'Agg.', 'Average', 'Grade', 'Position']
    const lines = displayRows.map((r, i) => [
      i + 1,
      r.name,
      r.admission,
      ...sheet.subjects.map((s) => (r.scores[s] !== null ? (r.scores[s] as number).toFixed(1) : '')),
      r.total !== null ? r.total.toFixed(1) : '',
      r.agg ?? '',
      r.average !== null ? r.average.toFixed(1) : '',
      r.grade ?? '',
      r.position ?? '',
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    // The BOM makes Excel open it with the right characters
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${myClass.name}-master-result-${term}.csv`.replace(/\s+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loadingClass) return <p className="text-sm text-gray-400">Loading...</p>

  if (!myClass) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">Master Result</h1>
        <p className="mt-4 text-sm text-gray-400">Master Result is only available to class teachers.</p>
      </div>
    )
  }

  const colCount = sheet.subjects.length + 7

  return (
    <div>
      {view !== 'menu' && (
        <button onClick={() => setView('menu')} className="mb-2 flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Master Result
        </button>
      )}
      <h1 className="text-xl font-semibold text-royal-900">
        {view === 'menu' ? 'Master Result' : view === 'new' ? 'New Results' : 'Recent Results'} · {myClass.name}
        {view !== 'menu' && <span className="text-gray-400"> · {term} · {examLabel}</span>}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Every subject's saved SBA for your class in one sheet. A missing result ("—") counts as 0, and every student is ranked.
      </p>

      {view === 'menu' && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => { setTerm(currentTerm); setView('new') }}
            className="rounded-2xl p-6 text-left text-white shadow-sm transition hover:shadow-md"
            style={{ background: 'linear-gradient(120deg, #1E3FBF 0%, #0F1F63 100%)' }}
          >
            <FilePlus2 className="h-8 w-8 text-gold-400" />
            <p className="mt-3 text-lg font-bold">New Results</p>
            <p className="mt-1 text-sm text-royal-100">{currentTerm}: build the master sheet and report from the latest saved SBA.</p>
          </button>
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <History className="h-8 w-8 text-gold-500" />
            <p className="mt-3 text-lg font-bold text-royal-900">Recent Results</p>
            {recent.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">No earlier term has saved results yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {recent.map((r) => (
                  <li key={r.term}>
                    <button
                      onClick={() => { setTerm(r.term); setView('recent') }}
                      className="flex w-full items-center justify-between py-2 text-left text-sm hover:text-royal-600"
                    >
                      <span className="font-semibold text-royal-900">{r.term}{r.exams.length ? ` · ${r.exams.join(' & ')}` : ''}</span>
                      <span className="text-xs text-gray-500">{r.subjects} subject{r.subjects === 1 ? '' : 's'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {view !== 'menu' && (<>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {view === 'new' && <div>
          <label className="block text-xs font-medium text-gray-500">Term</label>
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          >
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>}

        <div>
          <label className="block text-xs font-medium text-gray-500">Order</label>
          <div className="mt-1 flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm">
            {(['name', 'position'] as SortMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setSort(m)}
                className={`px-3 py-2 font-medium transition ${
                  sort === m ? 'bg-royal-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {m === 'name' ? 'A–Z' : 'By position'}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowReport(true)}
          disabled={loadingData || sheet.activeCount === 0}
          className="ml-auto flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-50"
        >
          <Eye className="h-4 w-4" />
          Preview report
        </button>

        <button
          onClick={downloadCsv}
          disabled={loadingData || sheet.rows.length === 0}
          className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Download (Excel)
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Could not load everything: {error}</p>
        </div>
      )}

      {!loadingData && sheet.rows.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile
            label="Complete results"
            value={`${sheet.completeCount}/${sheet.rows.length} students`}
            icon={<Users className="h-5 w-5" />}
          />
          <Tile
            label="Subjects with results"
            value={`${sheet.activeCount}/${sheet.subjects.length}`}
            icon={<ClipboardList className="h-5 w-5" />}
          />
          <Tile
            label="Class average"
            value={sheet.classAverage !== null ? sheet.classAverage.toFixed(1) : '—'}
            icon={<BarChart3 className="h-5 w-5" />}
          />
          <Tile
            label="Top of the class"
            value={sheet.toppers.length > 0 ? sheet.toppers.join(', ') : '—'}
            icon={<Trophy className="h-5 w-5" />}
          />
        </div>
      )}

      {!loadingData && sheet.activeCount > 0 && sheet.missingSubjects.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No saved SBA results yet for: <span className="font-semibold">{sheet.missingSubjects.join(', ')}</span>. These
            are not counted in totals or positions until the subject teacher saves them.
          </p>
        </div>
      )}

      {!loadingData && sheet.rows.length > 0 && sheet.activeCount === 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>No SBA results have been saved for {term} yet. Subject teachers need to save their SBA results first.</p>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SN</th>
              <th className="sticky left-0 z-10 min-w-[11rem] bg-white px-4 py-3">Name</th>
              {sheet.subjects.map((s) => {
                const missing = sheet.missingSubjects.includes(s)
                return (
                  <th
                    key={s}
                    title={missing ? `${s} — no saved results yet` : s}
                    className={`min-w-[5.5rem] px-3 py-3 text-center leading-tight ${missing ? 'text-gray-300' : ''}`}
                  >
                    {s}
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center">Total</th>
              <th className="px-3 py-3 text-center">Agg.</th>
              <th className="px-3 py-3 text-center">Avg</th>
              <th className="px-3 py-3 text-center">Grade</th>
              <th className="px-3 py-3 text-center">Position</th>
            </tr>
          </thead>
          <tbody>
            {loadingData ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  No students in this class.
                </td>
              </tr>
            ) : (
              displayRows.map((r, i) => (
                <tr key={r.studentId} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="whitespace-nowrap font-medium text-royal-900">{r.name}</p>
                    {!r.complete && sheet.activeCount > 0 && (
                      <p className="text-[11px] text-amber-600">
                        {r.count}/{sheet.activeCount} subjects
                      </p>
                    )}
                  </td>
                  {sheet.subjects.map((s) => {
                    const v = r.scores[s]
                    return (
                      <td
                        key={s}
                        className={`px-3 py-3 text-center ${v !== null ? `font-semibold ${gradeText(gradeFor(v))}` : 'text-gray-300'}`}
                      >
                        {v !== null ? v.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-center font-semibold text-royal-900">
                    {r.total !== null ? r.total.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-royal-900">{r.agg ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-gray-600">{r.average !== null ? r.average.toFixed(1) : '—'}</td>
                  <td className="px-3 py-3 text-center">
                    {r.grade ? (
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${gradeBadge(
                          r.grade
                        )}`}
                      >
                        {r.grade}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-royal-900">
                    {r.position !== null ? ordinal(r.position) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loadingData && displayRows.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600">
              <tr>
                <td className="px-4 py-3" />
                <td className="sticky left-0 z-10 bg-gray-50 px-4 py-3">Class average</td>
                {sheet.subjects.map((s) => (
                  <td key={s} className="px-3 py-3 text-center">
                    {sheet.subjectAverages[s] !== null ? (sheet.subjectAverages[s] as number).toFixed(1) : '—'}
                  </td>
                ))}
                <td className="px-3 py-3" colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      </>)}

      {showReport && (
        <MasterResultReport
          classLabel={myClass.name}
          term={term}
          examName={examLabel}
          subjects={sheet.subjects}
          missingSubjects={sheet.missingSubjects}
          rows={sheet.rows}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  )
}