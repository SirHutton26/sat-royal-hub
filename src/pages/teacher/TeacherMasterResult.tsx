import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, AlertCircle, Users, BarChart3, Trophy, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import MasterResultReport from './MasterResultReport'

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
  grade: string | null
  position: number | null
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
      if (!active) return
      setMyClass(data ?? null)
      setLoadingClass(false)
    }
    loadClass()
    return () => {
      active = false
    }
  }, [profile])

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
    const subjects = Array.from(new Set([...subjectNames, ...withResults])).sort((a, b) => a.localeCompare(b))
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
      const total = complete ? round2(activeSubjects.reduce((sum, sub) => sum + (scores[sub] as number), 0)) : null
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
        grade: average !== null ? gradeFor(average) : null,
        position: null,
      }
    })

    // Positions are only given to students who have a result in every subject; equal totals share a position
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

    const completeRows = rows.filter((r) => r.complete)
    const classAverage =
      completeRows.length > 0 ? completeRows.reduce((sum, r) => sum + (r.average as number), 0) / completeRows.length : null
    const toppers = rows.filter((r) => r.position === 1).map((r) => r.name)

    return {
      rows,
      subjects,
      activeCount: activeSubjects.length,
      missingSubjects,
      subjectAverages,
      completeCount: completeRows.length,
      classAverage,
      toppers,
    }
  }, [students, subjectNames, results])

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
    const header = ['SN', 'Name', 'Admission No', ...sheet.subjects, 'Total', 'Average', 'Grade', 'Position']
    const lines = displayRows.map((r, i) => [
      i + 1,
      r.name,
      r.admission,
      ...sheet.subjects.map((s) => (r.scores[s] !== null ? (r.scores[s] as number).toFixed(1) : '')),
      r.total !== null ? r.total.toFixed(1) : '',
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

  const colCount = sheet.subjects.length + 6

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Master Result · {myClass.name}</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every subject's saved SBA for your class in one sheet. Totals and positions are out of the subjects that have results.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
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
        </div>

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
          disabled={loadingData || sheet.completeCount === 0}
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
                <td className="px-3 py-3" colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showReport && (
        <MasterResultReport
          classLabel={myClass.name}
          term={term}
          subjects={sheet.subjects}
          missingSubjects={sheet.missingSubjects}
          rows={sheet.rows}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  )
}