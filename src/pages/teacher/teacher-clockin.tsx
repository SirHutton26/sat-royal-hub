import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode, History, Fingerprint } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { localISO, staffStatusLabel } from '@/lib/attendance'

export default function TeacherClockIn() {
  const { profile } = useAuth()
  const [today, setToday] = useState<{ clock_in_at: string | null; clock_out_at: string | null; status: string } | null>(null)

  useEffect(() => {
    if (!profile) return
    void supabase
      .from('staff_attendance')
      .select('clock_in_at, clock_out_at, status')
      .eq('teacher_id', profile.id)
      .eq('date', localISO())
      .maybeSingle()
      .then(({ data }) => setToday(data ?? null))
  }, [profile])

  const badge = !today?.clock_in_at
    ? { text: 'Not in yet', cls: 'bg-amber-100 text-amber-700' }
    : today.clock_out_at
      ? { text: 'Signed out', cls: 'bg-royal-100 text-royal-700' }
      : { text: staffStatusLabel(today.status), cls: 'bg-green-100 text-green-700' }

  const card =
    'flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-royal-900">Clock In</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-royal-600 px-2.5 py-1 text-xs font-bold text-white">
          <Fingerprint className="h-3.5 w-3.5" /> Staff
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">Sign in or out with the campus QR code, and review your clock-in history.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/teacher/clock-in/sign" className={card}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-royal-600 text-white">
              <QrCode className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Sign In / Out</h2>
              <p className="mt-0.5 text-xs text-gray-500">Scan the campus QR code</p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>{badge.text}</span>
        </Link>

        <Link to="/teacher/clock-in/history" className={card}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500 text-white">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Clock-In History</h2>
              <p className="mt-0.5 text-xs text-gray-500">Days present this month and term</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}
