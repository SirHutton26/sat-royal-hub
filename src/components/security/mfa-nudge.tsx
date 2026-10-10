import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

const KEY = 'sat-hub-mfa-nudge'

/** Reminds admin and bursar to turn on two-step login (hidden for a week once dismissed) */
export default function MfaNudge() {
  const { profile, offline } = useAuth()
  const [show, setShow] = useState(false)
  const settings = profile?.role === 'admin' ? '/admin/settings' : '/bursar/settings'

  useEffect(() => {
    setShow(false)
    if (!profile || offline || !navigator.onLine || !['admin', 'bursar'].includes(profile.role)) return
    if (Date.now() < Number(localStorage.getItem(KEY) ?? 0)) return
    let alive = true
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (alive && !(data?.totp?.length ?? 0)) setShow(true)
    })
    return () => {
      alive = false
    }
  }, [profile, offline])

  if (!show) return null
  return (
    <div className="fixed inset-x-3 top-3 z-[55] mx-auto flex max-w-xl items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg ring-1 ring-amber-200">
      <ShieldAlert className="h-5 w-5 shrink-0" />
      <p className="flex-1">Protect your account: turn on two-step login.</p>
      <Link to={settings} onClick={() => setShow(false)} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
        Set up
      </Link>
      <button
        onClick={() => {
          localStorage.setItem(KEY, String(Date.now() + 7 * 86400000))
          setShow(false)
        }}
        aria-label="Remind me later"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
