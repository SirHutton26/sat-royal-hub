import { useEffect, useState } from 'react'
import { LogOut, CheckCircle2, Clock, Calendar, AlertCircle, QrCode, X } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

interface AttendanceRecord {
  id: string
  clock_in_at: string | null
  clock_out_at: string | null
  status: string
}

const VALID_CAMPUS_QR_SECRET = 'SAT-ROYAL-CAMPUS-CHECKIN-2026'

export default function TeacherClockIn() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showScanner, setShowScanner] = useState(false)

  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  async function fetchTodayAttendance() {
    if (!profile) return
    setLoading(true)

    const todayDate = new Date().toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('staff_attendance')
      .select('id, clock_in_at, clock_out_at, status')
      .eq('teacher_id', profile.id)
      .eq('date', todayDate)
      .maybeSingle()

    if (!error && data) {
      setAttendance(data)
    } else {
      setAttendance(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchTodayAttendance()
  }, [profile])

  async function handleScan(result: any) {
    if (!result) return
    const scannedText = typeof result === 'string' ? result : result[0]?.rawValue || result?.text

    if (scannedText !== VALID_CAMPUS_QR_SECRET) {
      setToast({ type: 'error', message: 'Invalid QR code. Please scan the official campus check-in code at school.' })
      setShowScanner(false)
      return
    }

    setShowScanner(false)
    setActionLoading(true)
    setToast(null)

    const todayDate = new Date().toISOString().split('T')[0]
    const nowIso = new Date().toISOString()

    const { data, error } = await supabase
      .from('staff_attendance')
      .upsert(
        {
          teacher_id: profile?.id,
          date: todayDate,
          clock_in_at: nowIso,
          status: 'Present',
        },
        { onConflict: 'teacher_id,date' }
      )
      .select('id, clock_in_at, clock_out_at, status')
      .single()

    setActionLoading(false)
    if (error) {
      setToast({ type: 'error', message: error.message })
    } else {
      setAttendance(data)
      setToast({ type: 'success', message: 'Successfully checked in from campus!' })
    }
  }

  async function handleSignOut() {
    if (!profile || !attendance) return
    setActionLoading(true)
    setToast(null)

    const nowIso = new Date().toISOString()

    const { data, error } = await supabase
      .from('staff_attendance')
      .update({
        clock_out_at: nowIso,
        status: 'Signed Out',
      })
      .eq('id', attendance.id)
      .select('id, clock_in_at, clock_out_at, status')
      .single()

    setActionLoading(false)
    if (error) {
      setToast({ type: 'error', message: error.message })
    } else {
      setAttendance(data)
      setToast({ type: 'success', message: 'Successfully signed out. Have a great evening!' })
    }
  }

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '—'
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return <p className="p-6 text-sm text-gray-400">Loading attendance status...</p>
  }

  const hasCheckedIn = !!attendance?.clock_in_at
  const hasSignedOut = !!attendance?.clock_out_at

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      {toast && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-md ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <p>{toast.message}</p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-royal-50 p-2 text-royal-600 shadow-inner">
          <img src={schoolLogo} alt="Logo" className="h-12 w-12 object-contain" />
        </div>

        <h1 className="mt-4 text-xl font-bold text-royal-900">Staff Attendance</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500">
          <Calendar className="h-3.5 w-3.5" /> {todayStr}
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold">
          {!hasCheckedIn && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Not Checked In Yet</span>}
          {hasCheckedIn && !hasSignedOut && <span className="rounded-full bg-green-100 px-3 py-1 text-green-800">Currently on Campus (Checked In)</span>}
          {hasSignedOut && <span className="rounded-full bg-royal-100 px-3 py-1 text-royal-800">Day Completed (Signed Out)</span>}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
          <div>
            <p className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5" /> Check-In Time
            </p>
            <p className="mt-1 text-base font-bold text-royal-900">{formatTime(attendance?.clock_in_at ?? null)}</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5" /> Sign-Out Time
            </p>
            <p className="mt-1 text-base font-bold text-royal-900">{formatTime(attendance?.clock_out_at ?? null)}</p>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {!hasCheckedIn && (
            <button
              onClick={() => setShowScanner(true)}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white shadow transition hover:bg-green-700 disabled:opacity-60"
            >
              <QrCode className="h-5 w-5" />
              {actionLoading ? 'Processing...' : 'Scan Campus QR Code to Check In'}
            </button>
          )}

          {hasCheckedIn && !hasSignedOut && (
            <button
              onClick={handleSignOut}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white shadow transition hover:bg-royal-700 disabled:opacity-60"
            >
              <LogOut className="h-5 w-5" />
              {actionLoading ? 'Recording...' : 'Sign Out of Campus'}
            </button>
          )}

          {hasSignedOut && (
            <div className="rounded-xl bg-gray-100 py-3 text-center text-sm font-medium text-gray-600">
              You have successfully signed out for today. See you tomorrow!
            </div>
          )}
        </div>
      </div>

      {showScanner && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-royal-900">
                <QrCode className="h-4 w-4 text-royal-600" /> Scan Campus QR Code
              </h3>
              <button
                onClick={() => setShowScanner(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl bg-black">
              <Scanner
                onScan={(text: any) => handleScan(text)}
                onError={(error: any) => console.log(error?.message)}
                constraints={{ facingMode: 'environment' }}
              />
            </div>

            <p className="mt-3 text-center text-xs text-gray-500">
              Point your camera at the official attendance QR code displayed at the school administration or common room.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}