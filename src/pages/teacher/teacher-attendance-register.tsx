import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Search, GraduationCap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { localISO } from '@/lib/attendance'

type Status = 'present' | 'absent' | 'late'

interface Student {
  id: string
  full_name: string
  admission_number: string
}

const LEVEL_META: Record<string, { label: string; solid: string; soft: string; text: string }> = {
  creche: { label: 'Creche', solid: 'bg-pink-500', soft: 'bg-pink-50', text: 'text-pink-700' },
  nursery: { label: 'Nursery', solid: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700' },
  kg: { label: 'KG', solid: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  lower_primary: { label: 'Lower Primary', solid: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  upper_primary: { label: 'Upper Primary', solid: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700' },
  jhs: { label: 'JHS', solid: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700' },
}
const DEFAULT_LEVEL = { label: '', solid: 'bg-royal-600', soft: 'bg-royal-50', text: 'text-royal-700' }

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const STATUS_CELL: Record<Status, { letter: string; classes: string }> = {
  present: { letter: 'P', classes: 'bg-green-100 text-green-700' },
  late: { letter: 'L', classes: 'bg-amber-100 text-amber-700' },
  absent: { letter: 'A', classes: 'bg-red-100 text-red-700' },
}

const toISO = localISO

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatRange(monday: Date, friday: Date) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('en-GB', opts)} – ${friday.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`
}

export default function TeacherAttendanceRegister() {
  const { profile } = useAuth()
  const [classId, setClassId] = useState<string | null>(null)
  const [className, setClassName] = useState<string | null>(null)
  const [levelGroup, setLevelGroup] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [records, setRecords] = useState<Record<string, Status>>({}) // key: `${studentId}_${dateISO}`
  const [loading, setLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const weekDays = useMemo(() => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)), [weekStart])
  const currentWeekStart = getMonday(new Date())
  const isCurrentOrFutureWeek = toISO(weekStart) >= toISO(currentWeekStart)

  useEffect(() => {
    let active = true
    async function loadClass() {
      if (!profile) return
      const { data: myClass } = await supabase
        .from('classes')
        .select('id, name, level_group')
        .eq('teacher_id', profile.id)
        .maybeSingle()
      if (!active) return
      if (myClass) {
        setClassId(myClass.id)
        setClassName(myClass.name)
        setLevelGroup(myClass.level_group)
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, full_name, admission_number')
          .eq('class_id', myClass.id)
          .eq('is_active', true)
          .order('full_name')
        if (active) setStudents(studentRows ?? [])
      }
      setLoading(false)
    }
    loadClass()
    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    let active = true
    async function loadWeek() {
      if (!classId) return
      setRecordsLoading(true)
      const from = toISO(weekStart)
      const to = toISO(addDays(weekStart, 4))
      const { data } = await supabase
        .from('attendance')
        .select('student_id, date, status')
        .eq('class_id', classId)
        .gte('date', from)
        .lte('date', to)
      if (!active) return
      const map: Record<string, Status> = {}
      for (const row of data ?? []) map[`${row.student_id}_${row.date}`] = row.status as Status
      setRecords(map)
      setRecordsLoading(false)
    }
    loadWeek()
    return () => {
      active = false
    }
  }, [classId, weekStart])

  const level = LEVEL_META[levelGroup ?? ''] ?? DEFAULT_LEVEL

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => s.full_name.toLowerCase().includes(q))
  }, [students, searchQuery])

  const todayISO = toISO(new Date())

  return (
    <div>
      <Link to="/teacher/attendance" className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-royal-900">Attendance Register</h1>
        {className && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white ${level.solid}`}>
            <GraduationCap className="h-3.5 w-3.5" />
            {className}
          </span>
        )}
      </div>

      {!loading && !classId ? (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">You haven't been assigned a class yet. Contact your administrator.</p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekStart((w) => addDays(w, -7))}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="w-44 text-center text-sm font-semibold text-royal-900">
                {formatRange(weekDays[0], weekDays[4])}
              </p>
              <button
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                disabled={isCurrentOrFutureWeek}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 disabled:opacity-40"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Present
                <span className="ml-2 h-2.5 w-2.5 rounded-full bg-amber-400" /> Late
                <span className="ml-2 h-2.5 w-2.5 rounded-full bg-red-500" /> Absent
              </div>
            </div>
          </div>

          <div className="relative mb-4 mt-4 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search student by name"
              className="w-full rounded-xl border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-3">SN</th>
                  <th className="px-3 py-3">Name</th>
                  {weekDays.map((d, i) => {
                    const iso = toISO(d)
                    const isToday = iso === todayISO
                    return (
                      <th key={iso} title={DAY_NAMES[i]} className="px-2 py-3 text-center">
                        <div className={`mx-auto flex h-8 w-8 flex-col items-center justify-center rounded-lg ${isToday ? level.solid + ' text-white' : ''}`}>
                          <span className="text-[11px] font-bold leading-none">{DAY_LETTERS[i]}</span>
                          <span className="text-[9px] leading-none opacity-80">{d.getDate()}</span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {loading || recordsLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      Loading register...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      {students.length === 0 ? 'No students in your class yet.' : 'No students match your search.'}
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s, i) => (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-3 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-3 font-medium text-royal-900">
                        {s.full_name}
                        <span className="block text-xs text-gray-400">{s.admission_number}</span>
                      </td>
                      {weekDays.map((d) => {
                        const iso = toISO(d)
                        const status = records[`${s.id}_${iso}`]
                        return (
                          <td key={iso} className="px-2 py-3 text-center">
                            {status ? (
                              <span
                                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${STATUS_CELL[status].classes}`}
                              >
                                {STATUS_CELL[status].letter}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}