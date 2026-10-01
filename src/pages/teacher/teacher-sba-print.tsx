import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft } from 'lucide-react'
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
    <div className="flex items-end justify-center gap-6">
      {order.map((g) => (
        <div key={g} className="flex flex-col items-center gap-1">
          <div className="flex h-28 w-10 items-end">
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
    <div className="min-h-screen bg-gray-50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link to="/teacher/sba" className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none">
          <div className="flex flex-col items-center text-center">
            <img src={schoolLogo} alt="" className="h-20 w-20 object-contain" />
            <h1 className="mt-2 text-xl font-bold text-royal-900">SAT ROYAL BASIC SCHOOL</h1>
            <p className="text-xs uppercase tracking-widest text-gray-500">Knowledge Excels</p>
            <h2 className="mt-3 text-base font-semibold text-royal-900">Subject-Based Assessment (SBA) Report</h2>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 border-y border-gray-200 py-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Class</p>
              <p className="font-semibold text-royal-900">{className}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Subject</p>
              <p className="font-semibold text-royal-900">{subject}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Term</p>
              <p className="font-semibold text-royal-900">{term}</p>
            </div>
          </div>

          <table className="mt-6 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-gray-300 text-xs uppercase text-gray-500">
                <th className="py-2 pr-2">SN</th>
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Admission #</th>
                <th className="py-2 pr-2">Sub-Total A</th>
                <th className="py-2 pr-2">Exam B</th>
                <th className="py-2 pr-2">Total</th>
                <th className="py-2 pr-2">Grade</th>
                <th className="py-2 pr-2">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.student_id} className="border-b border-gray-100">
                  <td className="py-2 pr-2 text-gray-500">{i + 1}</td>
                  <td className="py-2 pr-2 font-medium text-royal-900">{r.student?.full_name}</td>
                  <td className="py-2 pr-2 text-gray-600">{r.student?.admission_number}</td>
                  <td className="py-2 pr-2">{r.component_a?.toFixed(1) ?? '—'}</td>
                  <td className="py-2 pr-2">{r.component_b?.toFixed(1) ?? '—'}</td>
                  <td className="py-2 pr-2 font-semibold">{r.total_score?.toFixed(1) ?? '—'}</td>
                  <td className="py-2 pr-2 font-bold">{r.grade ?? '—'}</td>
                  <td className="py-2 pr-2">{r.position ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-8">
            <p className="text-sm font-semibold text-royal-900">Grade distribution</p>
            <div className="mt-3">
              <GradeBarChart counts={gradeCounts} />
            </div>
          </div>

          <div className="mt-10 flex items-end justify-between text-sm">
            <div>
              <p className="text-xs text-gray-500">Date</p>
              <p className="mt-6 w-48 border-t border-gray-400 pt-1">{today}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Teacher's Signature</p>
              <p className="mt-6 w-48 border-t border-gray-400 pt-1">&nbsp;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}