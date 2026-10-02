import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft, Award, TrendingUp, Users, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import schoolLogo from '@/assets/school-logo.png'

interface ResultRow {
  student_id: string
  component_a: number | null
  exam_score: number | null
  component_b: number | null
  total_score: number | null
  grade: string | null
  position: number | null
  student: { full_name: string; admission_number: string } | null
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-600',
  B: 'bg-sky-600',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  E: 'bg-red-600',
}

function GradeBarChart({ counts }: { counts: Record<string, number> }) {
  const order = ['A', 'B', 'C', 'D', 'E']
  const max = Math.max(1, ...order.map((g) => counts[g] || 0))
  return (
    <div className="flex items-end justify-center gap-4 sm:gap-6">
      {order.map((g) => (
        <div key={g} className="flex flex-col items-center gap-1">
          <div className="flex h-24 sm:h-28 w-8 sm:w-10 items-end">
            <div className={`w-full rounded-t ${GRADE_COLORS[g]}`} style={{ height: `${((counts[g] || 0) / max) * 100}%` }} />
          </div>
          <p className="text-xs font-bold text-gray-700">{g}</p>
          <p className="text-[10px] text-gray-500">{counts[g] || 0}</p>
        </div>
      ))}
    </div>
  )
}

export default function TeacherSbaPrint() {
  const [params] = useSearchParams()
  const classId = params.get('classId') ?? ''
  const subject = params.get('subject') ?? ''
  const term = params.get('term') ?? ''

  const [className, setClassName] = useState('')
  const [rows, setRows] = useState<ResultRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!classId || !subject || !term) {
        setLoading(false)
        return
      }
      const [classRes, resultsRes] = await Promise.all([
        supabase.from('classes').select('name').eq('id', classId).single(),
        supabase
          .from('sba_results')
          .select('student_id, component_a, exam_score, component_b, total_score, grade, position, student:students(full_name, admission_number)')
          .eq('class_id', classId)
          .eq('subject', subject)
          .eq('term', term)
          .order('position', { ascending: true }),
      ])
      setClassName(classRes.data?.name ?? '')
      setRows((resultsRes.data as unknown as ResultRow[]) ?? [])
      setLoading(false)
    }
    load()
  }, [classId, subject, term])

  const gradeCounts = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.grade) acc[r.grade] = (acc[r.grade] || 0) + 1
    return acc
  }, {})

  const totalStudents = rows.length
  const validScores = rows.map((r) => r.total_score ?? 0).filter((s) => s > 0)
  const classAverage = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / totalStudents : 0
  const highestScore = validScores.length > 0 ? Math.max(...validScores) : 0
  const lowestScore = validScores.length > 0 ? Math.min(...validScores) : 0
  const passCount = rows.filter((r) => (r.total_score ?? 0) >= 50).length
  const passRate = totalStudents > 0 ? (passCount / totalStudents) * 100 : 0

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  if (loading) return <p className="p-6 text-sm text-gray-400">Loading...</p>

  if (rows.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500">No saved SBA results found for this subject and term.</p>
        <p className="text-xs text-gray-400">Save results on the SBA page first, then print.</p>
        <Link to="/teacher/sba" className="mt-2 flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to SBA
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-4 sm:px-4 sm:py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        {/* Navigation & Print buttons */}
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link to="/teacher/sba" className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700"
          >
            <Printer className="h-4 w-4" />
            Print Report
          </button>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none">
          {/* Header */}
          <div className="flex flex-col items-center text-center border-b border-gray-200 pb-6">
            <img src={schoolLogo} alt="School Logo" className="h-16 w-16 sm:h-20 sm:w-20 object-contain" />
            <h1 className="mt-2 text-xl sm:text-2xl font-bold tracking-wide text-royal-900">SAT ROYAL BASIC SCHOOL</h1>
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Knowledge Excels</p>
            <h2 className="mt-2 text-base sm:text-lg font-semibold text-royal-900">Subject Performance Report ({subject})</h2>
          </div>

          {/* Metadata Grid (Responsive 2 cols on mobile, 4 on desktop) */}
          <div className="mt-4 sm:mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 border-b border-gray-200 pb-4 text-xs sm:text-sm">
            <div>
              <p className="text-[11px] sm:text-xs text-gray-500">Class</p>
              <p className="font-semibold text-royal-900 truncate">{className}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-gray-500">Subject</p>
              <p className="font-semibold text-royal-900 truncate">{subject}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-gray-500">Term / Session</p>
              <p className="font-semibold text-royal-900 truncate">{term}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-gray-500">Class Size</p>
              <p className="font-semibold text-royal-900 truncate">{totalStudents} Students</p>
            </div>
          </div>

          {/* Performance Overview Banner (Responsive 2x2 grid on mobile, 4 cols on desktop) */}
          <div className="mt-4 sm:mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 rounded-xl bg-gray-50 p-3 sm:p-4 border border-gray-100">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="rounded-lg bg-royal-100 p-2 text-royal-700 shrink-0"><TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" /></div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-gray-500 truncate">Class Average</p>
                <p className="text-sm sm:text-base font-bold text-royal-900">{classAverage.toFixed(1)}%</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="rounded-lg bg-green-100 p-2 text-green-700 shrink-0"><Award className="h-4 w-4 sm:h-5 sm:w-5" /></div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-gray-500 truncate">Highest Score</p>
                <p className="text-sm sm:text-base font-bold text-royal-900">{highestScore.toFixed(1)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700 shrink-0"><AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" /></div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-gray-500 truncate">Lowest Score</p>
                <p className="text-sm sm:text-base font-bold text-royal-900">{lowestScore.toFixed(1)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="rounded-lg bg-blue-100 p-2 text-blue-700 shrink-0"><Users className="h-4 w-4 sm:h-5 sm:w-5" /></div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-gray-500 truncate">Pass Rate</p>
                <p className="text-sm sm:text-base font-bold text-royal-900">{passRate.toFixed(1)}% ({passCount}/{totalStudents})</p>
              </div>
            </div>
          </div>

          {/* Detailed Scores Table with Horizontal Scroll for Mobile */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs whitespace-nowrap sm:whitespace-normal">
              <thead>
                <tr className="border-b-2 border-gray-300 uppercase text-gray-500">
                  <th className="py-2 pr-2">SN</th>
                  <th className="py-2 pr-3">Student Name</th>
                  <th className="py-2 pr-3">Admission #</th>
                  <th className="py-2 px-2 text-center">Sub-Total A (50%)</th>
                  <th className="py-2 px-2 text-center">Exam Score</th>
                  <th className="py-2 px-2 text-center">Exam B (50%)</th>
                  <th className="py-2 px-2 text-center font-bold">Total (100%)</th>
                  <th className="py-2 px-2 text-center">Grade</th>
                  <th className="py-2 pl-2 text-center">Pos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.student_id} className="border-b border-gray-100 text-gray-800">
                    <td className="py-2.5 pr-2 text-gray-500">{i + 1}</td>
                    <td className="py-2.5 pr-3 font-medium text-royal-900">{r.student?.full_name}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{r.student?.admission_number}</td>
                    <td className="py-2.5 px-2 text-center">{r.component_a?.toFixed(1) ?? '—'}</td>
                    <td className="py-2.5 px-2 text-center">{r.exam_score !== null ? r.exam_score : '—'}</td>
                    <td className="py-2.5 px-2 text-center">{r.component_b?.toFixed(1) ?? '—'}</td>
                    <td className="py-2.5 px-2 text-center font-semibold text-royal-900">{r.total_score?.toFixed(1) ?? '—'}</td>
                    <td className="py-2.5 px-2 text-center font-bold">{r.grade ?? '—'}</td>
                    <td className="py-2.5 pl-2 text-center">{r.position ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Grade Distribution Chart */}
          <div className="mt-8 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:p-6">
            <p className="text-sm font-semibold text-royal-900 text-center mb-4">Grade Distribution for {subject}</p>
            <GradeBarChart counts={gradeCounts} />
          </div>

          {/* Signatures */}
          <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-500">Date Issued</p>
              <p className="mt-6 sm:mt-8 w-44 sm:w-48 border-t border-gray-400 pt-1 font-medium">{today}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Subject Teacher's Signature & Stamp</p>
              <p className="mt-6 sm:mt-8 w-52 sm:w-56 border-t border-gray-400 pt-1">&nbsp;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}