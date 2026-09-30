import { useEffect, useState } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { QrCode, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

interface TodayRecord {
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

interface HistoryRow {
  date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function QrScannerModal({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 220 }, false)
    scanner.render(
      (decodedText) => {
        scanner.clear().catch(() => {})
        onScan(decodedText)
      },
      () => {}
    )
    return () => {
      scanner.clear().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
      <div id="qr-reader" className="w-full max-w-sm overflow-hidden rounded-xl bg-white" />
      <button onClick={onClose} className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-semibold text-royal-900">
        Cancel
      </button>
    </div>
  )
}

export default function TeacherClockIn() {
  const { profile } = useAuth()
  const [today, setToday] = useState<TodayRecord | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showScanner, setShowScanner] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    if (!profile) return
    setLoading(true)
    const [todayRes, historyRes] = await Promise.all([
      supabase
        .from('staff_attendance')
        .select('clock_in_at, clock_out_at, status')
        .eq('teacher_id', profile.id)
        .eq('date', todayISO())
        .maybeSingle(),
      supabase
        .from('staff_attendance')
        .select('date, clock_in_at, clock_out_at, status')
        .eq('teacher_id', profile.id)
        .order('date', { ascending: false })
        .limit(5),
    ])
    setToday(todayRes.data ?? null)
    setHistory(historyRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function handleScan(text: string) {
    setShowScanner(false)
    setMessage(null)
    if (!profile) return

    const { data: settings } = await supabase
      .from('school_settings')
      .select('staff_qr_token, clock_in_cutoff')
      .eq('id', 1)
      .single()

    if (!settings || text.trim() !== settings.staff_qr_token) {
      setMessage('That QR code is not recognized.')
      return
    }

    setProcessing(true)
    const now = new Date()

    if (!today) {
      let status: 'present' | 'late' = 'present'
      if (settings.clock_in_cutoff) {
        const [h, m] = settings.clock_in_cutoff.split(':').map(Number)
        if (now.getHours() * 60 + now.getMinutes() > h * 60 + m) status = 'late'
      }
      const { error } = await supabase.from('staff_attendance').insert({
        teacher_id: profile.id,
        date: todayISO(),
        clock_in_at: now.toISOString(),
        status,
      })
      if (error) setMessage(error.code === '23505' ? "You've already clocked in today." : error.message)
    } else if (!today.clock_out_at) {
      const { error } = await supabase
        .from('staff_attendance')
        .update({ clock_out_at: now.toISOString() })
        .eq('teacher_id', profile.id)
        .eq('date', todayISO())
      if (error) setMessage(error.message)
    } else {
      setMessage("You've already completed attendance for today.")
    }

    setProcessing(false)
    await load()
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  const isDone = !!today?.clock_out_at

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Clock In</h1>

      <div className="mt-4 rounded-xl bg-white p-6 text-center shadow-sm">
        {isDone ? (
          <div>
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <p className="mt-2 text-sm text-gray-500">You've completed attendance for today</p>
            <p className="mt-1 text-sm text-gray-600">
              In: {new Date(today!.clock_in_at).toLocaleTimeString()} · Out:{' '}
              {new Date(today!.clock_out_at!).toLocaleTimeString()}
            </p>
          </div>
        ) : today ? (
          <div>
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <p className="mt-2 text-sm text-gray-500">Clocked in at</p>
            <p className="text-lg font-bold text-royal-900">{new Date(today.clock_in_at).toLocaleTimeString()}</p>
            <span
              className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                today.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
              }`}
            >
              {today.status === 'late' ? 'Late' : 'Present'}
            </span>
            <button
              onClick={() => setShowScanner(true)}
              disabled={processing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-royal-600 py-3 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              Scan to Clock Out
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-500">You haven't clocked in today.</p>
            <button
              onClick={() => setShowScanner(true)}
              disabled={processing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-royal-600 py-3 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              Scan to Clock In
            </button>
          </div>
        )}
        {message && <p className="mt-3 text-xs text-gray-500">{message}</p>}
      </div>

      {history.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-royal-900">Recent</p>
          <div className="mt-2 space-y-2">
            {history.map((h) => (
              <div key={h.date} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
                <span className="text-gray-600">{h.date}</span>
                <span className="text-gray-500">
                  {new Date(h.clock_in_at).toLocaleTimeString()}
                  {h.clock_out_at && ` – ${new Date(h.clock_out_at).toLocaleTimeString()}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    h.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {h.status === 'late' ? 'Late' : 'Present'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showScanner && <QrScannerModal onScan={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  )
}