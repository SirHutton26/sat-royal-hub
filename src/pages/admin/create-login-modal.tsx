import { useState } from 'react'
import { Loader2, AlertCircle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  row: { id: string; full_name: string; position: string; phone_number: string | null; email: string | null }
  onClose: () => void
  onDone: (message: string) => void
}

/** Same rule the create-staff function uses to pick the portal */
function portalFor(position: string) {
  if (/^\s*bursar\s*$/i.test(position)) return 'Bursar (fees portal)'
  if (/^\s*(sms|messenger|sms officer|communications?)\s*$/i.test(position)) return 'SMS Officer (messaging portal)'
  return 'Staff'
}

export default function CreateLoginModal({ row, onClose, onDone }: Props) {
  const [email, setEmail] = useState(row.email ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const mail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError('Enter a valid email address')
    if (password.length < 6) return setError('Password must be at least 6 characters')
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.functions.invoke('create-staff', {
      body: { fullName: row.full_name, email: mail, password, position: row.position, phone: row.phone_number },
    })
    if (err || data?.error) {
      let msg = data?.error ?? err?.message ?? 'Could not create the login'
      try {
        const j = await (err as unknown as { context: Response }).context.json()
        if (j?.error) msg = j.error
      } catch {
        /* keep message */
      }
      setBusy(false)
      return setError(msg)
    }
    // Keep the staff record linked to the login by email
    if (row.email?.trim().toLowerCase() !== mail) await supabase.from('non_teaching_staff').update({ email: mail }).eq('id', row.id)
    setBusy(false)
    onDone(`Login created for ${row.full_name}`)
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">Create login for {row.full_name}</h2>
        <p className="mt-1 text-sm text-gray-500">
          Position: <b>{row.position}</b> &rarr; portal: <b>{portalFor(row.position)}</b>
        </p>

        <label className="mt-4 block text-sm font-medium text-royal-900">Email (they sign in with this)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoFocus />
        <label className="mt-4 block text-sm font-medium text-royal-900">Password</label>
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={input} />
        <p className="mt-1 text-xs text-gray-500">Give them this password. They can change it in Settings.</p>

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button onClick={() => void save()} disabled={busy} className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create login
          </button>
        </div>
      </div>
    </div>
  )
}