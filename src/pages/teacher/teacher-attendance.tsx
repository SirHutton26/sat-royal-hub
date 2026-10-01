import { useEffect, useMemo, useState } from 'react'
import { Check, X, Clock, Save, Search, CheckCircle2, AlertCircle, GraduationCap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

type Status = 'present' | 'absent' | 'late'

interface Student {
  id: string
  full_name: string
  admission_number: string
}

type ToastState = { type: 'success' | 'error'; message: string } | null

const LEVEL_META: Record<string, { label: string; solid: string; soft: string; text: string }> = {
  creche: { label: 'Creche', solid: 'bg-pink-500', soft: 'bg-pink-50', text: 'text-pink-700' },
  nursery: { label: 'Nursery', solid: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700' },
  kg: { label: 'KG', solid: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  lower_primary: { label: 'Lower Primary', solid: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  upper_primary: { label: 'Upper Primary', solid: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700' },
  jhs: { label: 'JHS', solid: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700' },
}
const DEFAULT_LEVEL = { label: '', solid: 'bg-royal-600', soft: 'bg-royal-50', text: 'text-royal-700' }

const STATUS_OPTIONS: { value: Status; label: string; icon: typeof Check }[] = [
  { value: 'present', label: 'Present', icon: Check },
  { value: 'absent', label: 'Absent', icon: X },
  { value: 'late', label: 'Late', icon: Clock },
]

const STATUS_STYLES: Record<Status, string> = {
  present: 'bg-green-100 text-green-700 border-green-300',
  absent: 'bg-red-100 text-red-700 border-red-300',
  late: 'bg-amber-100 text-amber-700 border-amber-300',
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function SavingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-royal-900/40 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-royal-400 border-t-transparent" />
        <img src={schoolLogo} alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1" />
      </div>
      <p className="mt-4 text-sm font-medium text-white">Saving attendance...</p>
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
      <div className={`flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        <p className="text-sm font-medium">{toast.message}</p>
      </div>
    </div>
  )
}

export default function TeacherAttendance() {
  const { profile } = useAuth()
  const [classId, setClassId] = useState<string | null>(null)
  const [className, setClassName] = useState<string | null>(null)
  const [levelGroup, setLevelGroup] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [date, setDate] = useState(todayISO())
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [searchQuery, setSearchQuery] = useState('')

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
    async function loadMarks() {
      if (!classId) return
      const { data } = await supabase.from('attendance').select('student_id, status').eq('class_id', classId).eq('date', date)
      if (!active) return
      const map: Record<string, Status> = {}
      for (const row of data ?? []) map[row.student_id] = row.status as Status
      setMarks(map)
    }
    loadMarks()
    return () => {
      active = false
    }
  }, [classId, date])

  function setMark(studentId: string, status: Status) {
    setMarks((prev) => ({ ...prev, [studentId]: status }))
  }

  function markAllPresent() {
    const all: Record<string, Status> = {}
    for (const s of students) all[s.id] = 'present'
    setMarks(all)
  }

  async function saveAttendance() {
    if (!classId || !profile) return
    setSaving(true)

    const rows = students
      .filter((s) => marks[s.id])
      .map((s) => ({
        class_id: classId,
        student_id: s.id,
        date,
        status: marks[s.id],
        recorded_by: profile.id,
      }))

    if (rows.length === 0) {
      setSaving(false)
      setToast({ type: 'error', message: 'Mark at least one student first.' })
      return
    }

    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' })

    setSaving(false)
    setToast(error ? { type: 'error', message: error.message } : { type: 'success', message: 'Attendance saved!' })
  }

  const level = LEVEL_META[levelGroup ?? ''] ?? DEFAULT_LEVEL

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => s.full_name.toLowerCase().includes(q))
  }, [students, searchQuery])

  const markedCount = Object.keys(marks).length
  const counts = { present: 0, absent: 0, late: 0 }
  for (const status of Object.values(marks)) counts[status]++

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-royal-900">Attendance</h1>
            {className && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white ${level.solid}`}>
                <GraduationCap className="h-3.5 w-3.5" />
                {className}
              </span>
            )}
          </div>
          {!loading && students.length > 0 && (
            <span
              className={`mt-2 inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ${
                markedCount === students.length ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {markedCount}/{students.length} marked
            </span>
          )}
        </div>
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          className="w-fit rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        />
      </div>

      {!loading && !classId ? (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">You haven't been assigned a class yet. Contact your administrator.</p>
        </div>
      ) : (
        <>
          {markedCount > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
                <Check className="h-3 w-3" /> {counts.present} present
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700">
                <X className="h-3 w-3" /> {counts.absent} absent
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                <Clock className="h-3 w-3" /> {counts.late} late
              </span>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name"
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              />
            </div>
            <button
              onClick={markAllPresent}
              className={`w-fit rounded-md px-3 py-1.5 text-sm font-medium transition ${level.soft} ${level.text} hover:brightness-95`}
            >
              Mark all present
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">Loading...</div>
            ) : filteredStudents.length === 0 ? (
              <div className="rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">
                {students.length === 0 ? 'No students in your class yet.' : 'No students match your search.'}
              </div>
            ) : (
              filteredStudents.map((s, i) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-royal-900">{s.full_name}</p>
                      <p className="text-xs text-gray-400">{s.admission_number}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {STATUS_OPTIONS.map((opt) => {
                      const active = marks[s.id] === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setMark(s.id, opt.value)}
                          className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            active ? STATUS_STYLES[opt.value] : 'border-gray-200 text-gray-400 hover:border-gray-300'
                          }`}
                        >
                          <opt.icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {students.length > 0 && (
            <div className="sticky bottom-24 mt-4 flex items-center justify-end rounded-xl bg-white p-3 shadow-lg md:bottom-4">
              <button
                onClick={saveAttendance}
                disabled={saving}
                className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                Save attendance
              </button>
            </div>
          )}
        </>
      )}

      {saving && <SavingOverlay />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}