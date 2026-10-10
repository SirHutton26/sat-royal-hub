import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'

/** Second step of sign-in: the 6-digit code from the authenticator app */
export default function MfaChallenge({ onVerify, onCancel }: { onVerify: (code: string) => Promise<string | null>; onCancel: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(value: string) {
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    const err = await onVerify(value)
    if (err) {
      setError(err)
      setCode('')
    }
    setBusy(false)
  }

  return (
    <div className="relative z-10 mt-8 w-full max-w-sm rounded-3xl border border-gold-400/30 bg-[#FFFBEF]/95 p-7 shadow-2xl backdrop-blur-md">
      <ShieldCheck className="h-8 w-8 text-royal-600" />
      <h2 className="mt-3 text-xl font-bold text-royal-900">Two-step verification</h2>
      <p className="mt-1 text-sm text-gray-500">Open your authenticator app and enter the 6-digit code for SAT Royal Hub.</p>
      <input
        value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
          setCode(v)
          if (v.length === 6) void submit(v)
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="000000"
        className="mt-5 w-full rounded-xl border border-gold-400/30 bg-[#FFFBEF] py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
      />
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={() => void submit(code)}
        disabled={busy || code.length !== 6}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-royal-600 to-royal-700 py-2.5 font-semibold text-white shadow-md disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify
      </button>
      <button onClick={onCancel} className="mt-3 w-full text-center text-xs font-medium text-royal-600 hover:underline">
        Use a different account
      </button>
    </div>
  )
}
