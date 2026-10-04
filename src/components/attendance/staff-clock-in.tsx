import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Calendar, AlertCircle, QrCode, X, CalendarOff } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { CAMPUS_QR_SECRET, STAFF_WINDOWS, WEEKEND_MESSAGE, isWeekday, localISO } from '@/lib/attendance'
import schoolLogo from '@/assets/school-logo.png'

// Used by every staff member who scans the campus QR code (teachers and the bursar).
// Records go in staff_attendance, keyed by the signed-in profile id.

interface AttendanceRecord {
  id: string
  clock_in_at: string | null
  clock_out_at: string | null
  status: string
}

const { checkInStart, presentEnd, lateEnd, signOutStart, signOutEnd } = STAFF_WINDOWS

export default function StaffClockIn() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [scanMode, setScanMode] = useState<'check-in' | 'sign-out'>('check-in')

  // Re-evaluate the clock windows while the page stays open
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const schoolDay = isWeekday(now)
  const timeInMinutes = now.getHours() * 60 + now.getMinutes()
  const isMorningCheckInActive = schoolDay && timeInMinutes >= checkInStart && timeInMinutes <= lateEnd
  const isAfternoonSignOutActive = schoolDay && timeInMinutes >= signOutStart && timeInMinutes <= signOutEnd

  const todayStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  async function fetchTodayAttendance() {
    if (!profile) return
    setLoading(true)
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('id, clock_in_at, clock_out_at, status')
      .eq('teacher_id', profile.id)
      .eq('date', localISO())
      .maybeSingle()
    setAttendance(!error && data ? data : null)
    setLoading(false)
  }

  useEffect(() => {
    void fetchTodayAttendance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function handleScan(result: unknown) {
    if (!result) return
    const r = result as string | { rawValue?: string; text?: string }[] | { text?: string }
    const scannedText = typeof r === 'string' ? r : Array.isArray(r) ? r[0]?.rawValue : (r as { text?: string }).text

    setShowScanner(false)

    if (scannedText !== CAMPUS_QR_SECRET) {
      setToast({ type: 'error', message: 'Invalid QR code. Please scan the official campus code.' })
      return
    }
    if (!isWeekday(new Date())) {
      setToast({ type: 'error', message: WEEKEND_MESSAGE })
      return
    }

    setActionLoading(true)
    setToast(null)

    const today = localISO()
    const nowDate = new Date()
    const nowIso = nowDate.toISOString()
    const minutes = nowDate.getHours() * 60 + nowDate.getMinutes()

    if (scanMode === 'check-in') {
      const computedStatus = minutes > presentEnd && minutes <= lateEnd ? 'Late' : 'Present'

      const { data, error } = await supabase
        .from('staff_attendance')
        .upsert(
          { teacher_id: profile?.id, date: today, clock_in_at: nowIso, status: computedStatus },
          { onConflict: 'teacher_id,date' },
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
    } else {
      if (!attendance) {
        setActionLoading(false)
        return
      }
      const { data, error } = await supabase
        .from('staff_attendance')
        .update({ clock_out_at: nowIso })
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

  const formatTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

  if (loading) return <p className="p-6 text-sm text-gray-400">Loading attendance status...</p>

  const hasCheckedIn = !!attendance?.clock_in_at
  const hasSignedOut = !!attendance?.clock_out_at

  return (
    <div className="mx-auto max-w-xl">
      {toast && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-md ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <p>{toast.message}</p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-royal-50 p-2 text-royal-600 shadow-inner">
          <img src={schoolLogo} alt="Logo" className="h-12 w-12 object-contain" />
        </div>

        <h1 className="mt-4 text-xl font-bold text-royal-900">Staff Attendance</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500">
          <Calendar className="h-3.5 w-3.5" /> {todayStr}
        </p>

        {!schoolDay ? (
          <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 px-4 py-8">
            <CalendarOff className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-3 text-sm font-semibold text-royal-900">No attendance today</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-gray-500">{WEEKEND_MESSAGE} Check-in opens again on Monday.</p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
              {!hasCheckedIn && timeInMinutes > lateEnd && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">Marked Absent (Missed Check-In Window)</span>
              )}
              {!hasCheckedIn && timeInMinutes <= lateEnd && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Not Checked In Yet</span>
              )}
              {hasCheckedIn && !hasSignedOut && (
                <span className="rounded-full bg-green-100 px-3 py-1 text-green-800">
                  Status: {attendance?.status} (Checked In)
                </span>
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
              {!hasCheckedIn && isMorningCheckInActive && (
                <button
                  onClick={() => {
                    setScanMode('check-in')
                    setShowScanner(true)
                  }}
                  disabled={actionLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 text-sm font-semibold text-white shadow transition hover:bg-green-700 disabled:opacity-60"
                >
                  <QrCode className="h-5 w-5" />
                  {actionLoading
                    ? 'Processing...'
                    : timeInMinutes <= presentEnd
                      ? 'Scan QR Code to Check In (Present)'
                      : 'Scan QR Code to Check In (Late)'}
                </button>
              )}

              {!hasCheckedIn && timeInMinutes > lateEnd && timeInMinutes < signOutStart && (
                <div className="rounded-xl border border-red-100 bg-red-50 py-3 text-center text-xs font-semibold text-red-700">
                  Check-in window closed at 9:15 AM. You have been marked absent for today.
                </div>
              )}

              {!hasCheckedIn && timeInMinutes < checkInStart && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 py-3 text-center text-xs font-medium text-gray-500">
                  Check-in opens at 6:00 AM.
                </div>
              )}

              {hasCheckedIn && !hasSignedOut && isAfternoonSignOutActive && (
                <button
                  onClick={() => {
                    setScanMode('sign-out')
                    setShowScanner(true)
                  }}
                  disabled={actionLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3.5 text-sm font-semibold text-white shadow transition hover:bg-royal-700 disabled:opacity-60"
                >
                  <QrCode className="h-5 w-5" />
                  {actionLoading ? 'Processing...' : 'Scan QR Code to Sign Out'}
                </button>
              )}

              {hasCheckedIn && !hasSignedOut && !isAfternoonSignOutActive && timeInMinutes < signOutStart && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 py-3 text-center text-xs font-medium text-gray-500">
                  Checked in successfully! Sign-out QR scanner will be active from 3:00 PM to 6:00 PM.
                </div>
              )}

              {hasSignedOut && (
                <div className="rounded-xl bg-gray-100 py-3 text-center text-sm font-medium text-gray-600">
                  You have successfully signed out for today. See you tomorrow!
                </div>
              )}
            </div>
          </>
        )}
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
                aria-label="Close scanner"
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl bg-black">
              <Scanner
                onScan={(codes: unknown) => void handleScan(codes)}
                onError={(error: unknown) => console.log((error as Error)?.message)}
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