import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'

const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/** Turn two-step login (authenticator app) on or off for the signed-in account */
export default function MfaSetup() {
  const [loading, setLoading] = useState(true)
  const [factorId, setFactorId] = useState<string | null>(null) // verified factor, if any
  const [enroll, setEnroll] = useState<{ id: string; uri: string; secret: string } | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactorId(data?.totp?.[0]?.id ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function start() {
    setMsg(null)
    setBusy(true)
    // clear half-finished set-ups from earlier tries
    const { data: all } = await supabase.auth.mfa.listFactors()
    for (const f of all?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'SAT Royal Hub',
      friendlyName: `Authenticator ${Date.now()}`,
    })
    setBusy(false)
    if (error || !data) return setMsg({ ok: false, text: error?.message ?? 'Could not start set-up' })
    setEnroll({ id: data.id, uri: data.totp.uri, secret: data.totp.secret })
    setCode('')
  }

  async function check(id: string, value: string) {
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: id })
    if (chErr || !ch) return chErr?.message ?? 'Could not check the code'
    const { error } = await supabase.auth.mfa.verify({ factorId: id, challengeId: ch.id, code: value.trim() })
    return error ? 'That code is not correct. Try the next one.' : null
  }

  async function confirmEnroll() {
    if (!enroll || code.length !== 6) return
    setBusy(true)
    const err = await check(enroll.id, code)
    setBusy(false)
    if (err) return setMsg({ ok: false, text: err })
    setEnroll(null)
    setCode('')
    setMsg({ ok: true, text: 'Two-step login is now ON. You will be asked for a code each time you sign in.' })
    await load()
  }

  async function confirmDisable() {
    if (!factorId || code.length !== 6) return
    setBusy(true)
    const err = await check(factorId, code)
    if (err) {
      setBusy(false)
      return setMsg({ ok: false, text: err })
    }
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setDisabling(false)
    setCode('')
    setMsg({ ok: true, text: 'Two-step login is now OFF.' })
    await load()
  }

  const codeBox = (onDone: () => void, label: string) => (
    <div className="mt-4">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        className={inputClass}
      />
      <button
        onClick={onDone}
        disabled={busy || code.length !== 6}
        className="mt-3 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
    </div>
  )

  return (
    <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-royal-900">
        <ShieldCheck className="h-5 w-5" /> Two-step login
      </h2>

      {loading ? (
        <Loader2 className="mt-3 h-5 w-5 animate-spin text-gray-400" />
      ) : enroll ? (
        <div className="mt-3">
          <p className="text-sm text-gray-600">
            1. Install an authenticator app (Google Authenticator, Microsoft Authenticator or Authy).
            <br />
            2. Scan this code, or type the key below into the app.
            <br />
            3. Enter the 6-digit code the app shows.
          </p>
          <div className="mt-4 inline-block rounded-xl border border-gray-200 bg-white p-3">
            <QRCodeSVG value={enroll.uri} size={176} />
          </div>
          <p className="mt-2 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{enroll.secret}</p>
          {codeBox(confirmEnroll, 'Turn on')}
          <button onClick={() => { setEnroll(null); setCode('') }} className="mt-2 text-xs font-medium text-gray-500 hover:underline">
            Cancel
          </button>
        </div>
      ) : factorId ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" /> On. A code is needed every time you sign in.
          </p>
          {disabling ? (
            <>
              <p className="mt-3 text-sm text-gray-600">Enter a current code to turn it off.</p>
              {codeBox(confirmDisable, 'Turn off')}
              <button onClick={() => { setDisabling(false); setCode('') }} className="mt-2 text-xs font-medium text-gray-500 hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => { setDisabling(true); setMsg(null) }} className="mt-3 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
              Turn off
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-gray-600">Add a second lock to this account. Even if someone learns your password, they cannot sign in without the code from your phone.</p>
          <button onClick={start} disabled={busy} className="mt-3 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Set up
          </button>
        </div>
      )}

      {msg && (
        <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
        </p>
      )}
    </div>
  )
}
