import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Teacher {
  id: string
  full_name: string | null
  email: string | null
}

interface Record {
  teacher_id: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function AdminStaffAttendance() {
  const [date, setDate] = useState(todayISO())
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [teachersRes, recordsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email').eq('role', 'teacher').eq('is_active', true).order('full_name'),
        supabase.from('staff_attendance').select('teacher_id, clock_in_at, clock_out_at, status').eq('date', date),
      ])
      if (!active) return
      setTeachers(teachersRes.data ?? [])
      setRecords(recordsRes.data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [date])

  const byTeacher = new Map(records.map((r) => [r.teacher_id, r]))
  const presentCount = records.filter((r) => r.status === 'present').length
  const lateCount = records.filter((r) => r.status === 'late').length
  const missingCount = teachers.length - records.length

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-royal-900">Staff attendance</h1>
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        />
      </div>

      {!loading && (
        <p className="mt-2 text-sm text-gray-500">
          {presentCount} present · {lateCount} late · {missingCount} not clocked in
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Clock-in</th>
              <th className="px-4 py-3">Clock-out</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading...</td>
              </tr>
            ) : teachers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No teachers found.</td>
              </tr>
            ) : (
              teachers.map((t) => {
                const r = byTeacher.get(t.id)
                return (
                  <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/50">
                    <td className="px-4 py-3 font-medium text-royal-900">{t.full_name || t.email}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {r ? new Date(r.clock_in_at).toLocaleTimeString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r?.clock_out_at ? new Date(r.clock_out_at).toLocaleTimeString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {!r ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Not clocked in
                        </span>
                      ) : r.status === 'late' ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Late
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          Present
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}