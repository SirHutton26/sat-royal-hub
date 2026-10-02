import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, History, GraduationCap, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

const MARKING_START_HOUR = 7
const MARKING_END_HOUR = 12

const LEVEL_META: Record<string, { label: string; solid: string; soft: string; text: string }> = {
  creche: { label: 'Creche', solid: 'bg-pink-500', soft: 'bg-pink-50', text: 'text-pink-700' },
  nursery: { label: 'Nursery', solid: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700' },
  kg: { label: 'KG', solid: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  lower_primary: { label: 'Lower Primary', solid: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  upper_primary: { label: 'Upper Primary', solid: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700' },
  jhs: { label: 'JHS', solid: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700' },
}
const DEFAULT_LEVEL = { label: '', solid: 'bg-royal-600', soft: 'bg-royal-50', text: 'text-royal-700' }

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function TeacherAttendance() {
  const { profile } = useAuth()
  const [className, setClassName] = useState<string | null>(null)
  const [levelGroup, setLevelGroup] = useState<string | null>(null)
  const [studentCount, setStudentCount] = useState(0)
  const [markedCount, setMarkedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const hourFloat = now.getHours() + now.getMinutes() / 60
  const markingOpen = hourFloat >= MARKING_START_HOUR && hourFloat < MARKING_END_HOUR

  useEffect(() => {
    let active = true
    async function load() {
      if (!profile) return
      const { data: myClass } = await supabase
        .from('classes')
        .select('id, name, level_group')
        .eq('teacher_id', profile.id)
        .maybeSingle()
      if (!active || !myClass) {
        setLoading(false)
        return
      }
      setClassName(myClass.name)
      setLevelGroup(myClass.level_group)

      const [{ count: total }, { count: marked }] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('class_id', myClass.id).eq('is_active', true),
        supabase
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('class_id', myClass.id)
          .eq('date', todayISO()),
      ])
      if (!active) return
      setStudentCount(total ?? 0)
      setMarkedCount(marked ?? 0)
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [profile])

  const level = LEVEL_META[levelGroup ?? ''] ?? DEFAULT_LEVEL

  return (
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
      <p className="mt-1 text-xs text-gray-500">Record daily attendance and review the weekly register.</p>

      {!loading && !className ? (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">You haven't been assigned a class yet. Contact your administrator.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            to="/teacher/attendance/mark"
            className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
          >
            <div className="flex items-center gap-3.5">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-white ${level.solid}`}>
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-royal-900">Mark Attendance</h2>
                <p className="mt-0.5 text-xs text-gray-500">Take today's register</p>
              </div>
            </div>
            {markingOpen ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  studentCount > 0 && markedCount === studentCount ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {markedCount}/{studentCount}
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">
                <Lock className="h-3 w-3" /> Closed
              </span>
            )}
          </Link>

          <Link
            to="/teacher/attendance/register"
            className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-400 text-white">
                <History className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-royal-900">Attendance Register</h2>
                <p className="mt-0.5 text-xs text-gray-500">Weekly view, Monday to Friday</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">View</span>
          </Link>
        </div>
      )}
    </div>
  )
}