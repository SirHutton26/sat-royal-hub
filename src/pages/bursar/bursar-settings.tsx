import OfflineDownload from '@/components/offline/offline-download'
import MfaSetup from '@/components/security/mfa-setup'
import { useState } from 'react'
import { KeyRound, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

const MIN_PASSWORD = 6

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function BursarSettings() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function close() {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setShow(false)
    setError(null)
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)

    if (!profile?.email) return setError('Your account has no email on file. Contact the administrator.')
    if (!current) return setError('Enter your current password')
    if (next.length < MIN_PASSWORD) return setError(`New password must be at least ${MIN_PASSWORD} characters`)
    if (next !== confirm) return setError("New passwords don't match")
    if (next === current) return setError('Choose a password different from your current one')

    setBusy(true)
    // Confirm the current password first, so a borrowed, unlocked device can't change it
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: profile.email, password: current })
    if (verifyError) {
      setBusy(false)
      return setError('Your current password is incorrect')
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (updateError) return setError(updateError.message)

    close()
    setDone(true)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-royal-900">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Manage your account.</p>
      <MfaSetup />
      <OfflineDownload />

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Password</h2>
              <p className="mt-0.5 text-xs text-gray-500">Change the password you use to sign in{profile?.email ? ` (${profile.email})` : ''}.</p>
            </div>
          </div>
          {!open && (
            <button
              onClick={() => {
                setDone(false)
                setOpen(true)
              }}
              className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700"
            >
              Reset Password
            </button>
          )}
        </div>

        {done && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Your password has been changed.
          </p>
        )}

        {open && (
          <form onSubmit={(e) => void resetPassword(e)} className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div>
              <label className="block text-sm font-medium text-royal-900">Current password</label>
              <input
                type={show ? 'text' : 'password'}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-royal-900">New password</label>
              <input
                type={show ? 'text' : 'password'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-royal-900">Confirm new password</label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={`${inputClass} mt-1`}
              />
            </div>
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {show ? 'Hide passwords' : 'Show passwords'}
            </button>

            {error && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Saving...' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
