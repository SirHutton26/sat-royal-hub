import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'

// Signs the user out after 5 minutes without activity, with a 30 second warning first.
// Activity is shared between browser tabs, so working in one tab keeps the others signed in.

export const IDLE_LIMIT_MS = 5 * 60 * 1000
const WARNING_MS = 30 * 1000
export const IDLE_NOTICE_KEY = 'sat-hub-idle-logout' // read by the login page to explain the sign-out
const ACTIVITY_KEY = 'sat-hub-last-activity'
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'click'] as const

function readLast(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0
  } catch {
    return 0
  }
}

function writeLast(t: number) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t))
  } catch {
    // storage unavailable: this tab still tracks its own activity below
  }
}

export default function IdleLogout() {
  const { session, profile, signOut } = useAuth()
  const signedIn = !!session && !!profile
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastRef = useRef(Date.now())
  const warningRef = useRef(false)
  const signingOut = useRef(false)

  const markActive = useCallback(() => {
    const now = Date.now()
    lastRef.current = now
    writeLast(now)
  }, [])

  useEffect(() => {
    if (!signedIn) return
    signingOut.current = false
    markActive() // a fresh sign-in starts a fresh timer

    // Plain activity counts, until the warning is up. After that only the button counts,
    // so a stray mouse nudge cannot dismiss it unseen.
    let lastWrite = 0
    function onActivity() {
      if (warningRef.current) return
      const now = Date.now()
      lastRef.current = now
      if (now - lastWrite > 1000) {
        lastWrite = now
        writeLast(now)
      }
    }
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }))

    // Timestamps, not a single long timer: this still works after the laptop sleeps or the tab is throttled
    const tick = window.setInterval(() => {
      const idle = Date.now() - Math.max(lastRef.current, readLast())
      if (idle >= IDLE_LIMIT_MS) {
        if (signingOut.current) return
        signingOut.current = true
        warningRef.current = false
        setSecondsLeft(null)
        try {
          localStorage.setItem(IDLE_NOTICE_KEY, '1')
        } catch {
          // the sign-out still happens, the login notice just won't show
        }
        void signOut(false)
      } else if (idle >= IDLE_LIMIT_MS - WARNING_MS) {
        warningRef.current = true
        setSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idle) / 1000))
      } else if (warningRef.current) {
        // another tab was used, so this one is active again
        warningRef.current = false
        setSecondsLeft(null)
      }
    }, 1000)

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }))
      window.clearInterval(tick)
      warningRef.current = false
      setSecondsLeft(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  function stay() {
    warningRef.current = false
    setSecondsLeft(null)
    markActive()
  }

  if (!signedIn || secondsLeft === null) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-400/20 text-gold-500">
          <Clock className="h-6 w-6" />
        </div>
        <h2 id="idle-title" className="mt-4 text-lg font-bold text-royal-900">
          Are you still there?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          For your security you will be signed out in <span className="font-bold text-royal-900">{secondsLeft}s</span> because of inactivity.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              signingOut.current = true
              void signOut(false)
            }}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            Sign out
          </button>
          <button
            autoFocus
            onClick={stay}
            className="rounded-xl bg-royal-600 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-royal-700"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}