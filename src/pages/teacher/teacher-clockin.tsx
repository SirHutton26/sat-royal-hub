import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Calendar, AlertCircle, QrCode, X } from 'lucide-react'
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
  const [scanMode, setScanMode] = useState<'check-in' | 'sign-out'>('check-in')

  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const timeInMinutes = currentHour * 60 + currentMinute

  // Time window rules in minutes from midnight
  const CHECK_IN_START = 6 * 60       // 6:00 AM
  const PRESENT_END = 7 * 60 + 15     // 7:15 AM
  const LATE_END = 9 * 60 + 15        // 9:15 AM
  const SIGN_OUT_START = 15 * 60      // 3:00 PM (15:00)
  const SIGN_OUT_END = 18 * 60        // 6:00 PM (18:00)

  const isMorningCheckInActive = timeInMinutes >= CHECK_IN_START && timeInMinutes <= LATE_END
  const isAfternoonSignOutActive = timeInMinutes >= SIGN_OUT_START && timeInMinutes <= SIGN_OUT_END

  const todayStr = now.toLocaleDateString('en-GB', {
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
      setToast({ type: 'error', message: 'Invalid QR code. Please scan the official campus code.' })
      setShowScanner(false)
      return
    }

    setShowScanner(false)
    setActionLoading(true)
    setToast(null)

    const todayDate = new Date().toISOString().split('T')[0]
    const nowIso = new Date().toISOString()

    if (scanMode === 'check-in') {
      // Determine status based on arrival time
      let computedStatus = 'Present'
      if (timeInMinutes > PRESENT_END && timeInMinutes <= LATE_END) {
        computedStatus = 'Late'
      }

      const { data, error } = await supabase
        .from('staff_attendance')
        .upsert(
          {
            teacher_id: profile?.id,
            date: todayDate,
            clock_in_at: nowIso,
            status: computedStatus,
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
        setToast({ type: 'success', message: `Checked in successfully (${computedStatus})!` })
      }
    } else if (scanMode === 'sign-out') {
      if (!attendance) return

      const { data, error } = await supabase
        .from('staff_attendance')
        .update({
          clock_out_at: nowIso,
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
          {!hasCheckedIn && timeInMinutes > LATE_END && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">Marked Absent (Missed Check-In Window)</span>
          )}
          {!hasCheckedIn && timeInMinutes <= LATE_END && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Not Checked In Yet</span>
          )}
          {hasCheckedIn && !hasSignedOut && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-green-800">Status: {attendance.status} (Checked In)</span>
          )}
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
          {/* MORNING CHECK-IN */}
          {!hasCheckedIn && isMorningCheckInActive && (
            <button
              onClick={() => {
                setScanMode('check-in')
                setShowScanner(true)
              }}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white shadow transition hover:bg-green-700 disabled:opacity-60"
            >
              <QrCode className="h-5 w-5" />
              {actionLoading ? 'Processing...' : timeInMinutes <= PRESENT_END ? 'Scan QR Code to Check In (Present)' : 'Scan QR Code to Check In (Late)'}
            </button>
          )}

          {!hasCheckedIn && !isMorningCheckInActive && timeInMinutes > LATE_END && timeInMinutes < SIGN_OUT_START && (
            <div className="rounded-xl bg-red-50 py-3 text-center text-xs font-semibold text-red-700 border border-red-100">
              Check-in window closed at 9:15 AM. You have been marked absent for today.
            </div>
          )}

          {!hasCheckedIn && timeInMinutes < CHECK_IN_START && (
            <div className="rounded-xl bg-gray-50 py-3 text-center text-xs font-medium text-gray-500 border border-gray-100">
              Check-in opens at 6:00 AM.
            </div>
          )}

          {/* AFTERNOON SIGN-OUT */}
          {hasCheckedIn && !hasSignedOut && isAfternoonSignOutActive && (
            <button
              onClick={() => {
                setScanMode('sign-out')
                setShowScanner(true)
              }}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white shadow transition hover:bg-royal-700 disabled:opacity-60"
            >
              <QrCode className="h-5 w-5" />
              {actionLoading ? 'Processing...' : 'Scan QR Code to Sign Out'}
            </button>
          )}

          {hasCheckedIn && !hasSignedOut && !isAfternoonSignOutActive && timeInMinutes < SIGN_OUT_START && (
            <div className="rounded-xl bg-gray-50 py-3 text-center text-xs font-medium text-gray-500 border border-gray-100">
              Checked in successfully! Sign-out QR scanner will be active from 3:00 PM to 6:00 PM.
            </div>
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
                <QrCode className="h-4 w-4 text-royal-600" /> {scanMode === 'check-in' ? 'Campus Check-In' : 'Campus Sign-Out'}
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
              Scan the official campus QR code to complete your {scanMode === 'check-in' ? 'check-in' : 'sign-out'}.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}