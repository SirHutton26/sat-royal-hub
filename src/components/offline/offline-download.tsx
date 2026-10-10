import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CloudDownload, Loader2 } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { waitForIdle } from '@/lib/offline-fetch'
import { warmBalances } from '@/lib/offline-sync'

// Pages that are safe to open automatically (no camera, no printing, no search-only screens)
const ROUTES: Record<string, string[]> = {
  admin: ['', 'teachers', 'class', 'students', 'alerts', 'subjects', 'exams', 'settings', 'staff-attendance', 'fees', 'fees/arrears', 'non-staff', 'daily-rates'].map((p) => `/admin/${p}`.replace(/\/$/, '')),
  bursar: ['', 'record-payment', 'receipts', 'students', 'reports', 'attendance', 'activity', 'daily', 'settings'].map((p) => `/bursar/${p}`.replace(/\/$/, '')),
  storekeeper: ['', 'week', 'items'].map((p) => `/storekeeper/${p}`.replace(/\/$/, '')),
  teacher: ['', 'class', 'attendance', 'attendance/mark', 'attendance/register', 'grades', 'alerts', 'exams', 'score-bank', 'sba', 'fees'].map((p) => `/teacher/${p}`.replace(/\/$/, '')),
}

export default function OfflineDownload() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const here = useLocation().pathname
  const [step, setStep] = useState<{ i: number; n: number } | null>(null)
  const [cancel, setCancel] = useState(false)
  const [done, setDone] = useState(() => localStorage.getItem('sat-hub-offline-ready') ?? '')
  const routes = ROUTES[profile?.role ?? ''] ?? []

  if (!routes.length) return null

  async function run() {
    if (!navigator.onLine) return
    let stop = false
    setCancel(false)
    const onCancel = () => (stop = true)
    window.addEventListener('hub-cancel-download', onCancel)
    for (let i = 0; i < routes.length && !stop; i++) {
      setStep({ i: i + 1, n: routes.length })
      navigate(routes[i])
      await waitForIdle()
    }
    window.removeEventListener('hub-cancel-download', onCancel)
    if (!stop && (profile?.role === 'bursar' || profile?.role === 'admin')) await warmBalances(true)
    navigate(here)
    setStep(null)
    if (!stop) {
      const when = new Date().toLocaleString()
      localStorage.setItem('sat-hub-offline-ready', when)
      setDone(when)
    }
  }

  return (
    <>
      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold text-royal-900">
          <CloudDownload className="h-5 w-5" /> Use offline
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Save all your pages on this phone so they open without internet. Do this while connected, once in a while.
        </p>
        {done && <p className="mt-2 text-xs text-green-700">Last saved: {done}</p>}
        <button
          onClick={run}
          disabled={!!step || !navigator.onLine}
          className="mt-3 rounded-lg bg-royal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {navigator.onLine ? 'Download for offline' : 'Connect to the internet first'}
        </button>
      </div>
      {step && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-royal-900/90 p-6 text-center text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="font-semibold">
            Saving pages for offline use ({step.i}/{step.n})
          </p>
          <p className="text-sm text-white/70">Please wait, do not close the app.</p>
          <button
            onClick={() => {
              setCancel(true)
              window.dispatchEvent(new Event('hub-cancel-download'))
            }}
            disabled={cancel}
            className="mt-2 rounded-lg border border-white/40 px-4 py-1.5 text-sm"
          >
            {cancel ? 'Stopping...' : 'Cancel'}
          </button>
        </div>
      )}
    </>
  )
}
