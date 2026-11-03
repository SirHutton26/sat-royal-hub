import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Loader2, Search, AlertCircle, CheckCircle2, Shuffle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
  role: string
  is_active: boolean
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const a = new Uint32Array(8)
  crypto.getRandomValues(a)
  return Array.from(a, (n) => chars[n % chars.length]).join('')
}

export default function AdminResetPassword() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<UserRow | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    void supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .order('full_name')
      .then(({ data }) => {
        setUsers((data as UserRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return users.filter((u) => !s || `${u.full_name ?? ''} ${u.email ?? ''} ${u.role}`.toLowerCase().includes(s))
  }, [users, q])

  function pick(u: UserRow) {
    setSel(u)
    setPassword('')
    setError('')
    setDone('')
  }

  async function reset() {
    if (!sel) return
    if (password.length < 6) return setError('Password must be at least 6 characters')
    setBusy(true)
    setError('')
    setDone('')
    const { data, error: err } = await supabase.functions.invoke('reset-password', {
      body: { userId: sel.id, password },
    })
    setBusy(false)
    if (err || data?.error) {
      let msg = data?.error ?? err?.message ?? 'Could not reset the password'
      try {
        const j = await (err as unknown as { context: Response }).context.json()
        if (j?.error) msg = j.error
      } catch {
        /* keep message */
      }
      return setError(msg)
    }
    setDone(`Password reset for ${sel.full_name || sel.email}. New password: ${password}`)
    setPassword('')
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="flex items-center gap-2 text-xl font-bold text-royal-900">
        <KeyRound className="h-5 w-5" /> Reset Password
      </h1>
      <p className="mt-1 text-sm text-gray-500">Pick a user, set a new password, and give it to them.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email or role"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
          </div>
          <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
            {loading ? (
              <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-royal-600" />
            ) : list.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No users found</p>
            ) : (
              list.map((u) => (
                <button
                  key={u.id}
                  onClick={() => pick(u)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    sel?.id === u.id ? 'bg-gold-400 text-royal-900' : 'hover:bg-royal-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.full_name || '(no name)'}</span>
                    <span className="block truncate text-xs text-gray-500">{u.email}</span>
                  </span>
                  <span className="ml-2 shrink-0 rounded-full bg-royal-100 px-2 py-0.5 text-xs capitalize text-royal-700">{u.role}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          {!sel ? (
            <p className="py-10 text-center text-sm text-gray-500">Select a user to reset their password</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-royal-900">{sel.full_name || sel.email}</h2>
              <p className="text-sm text-gray-500">
                {sel.email} · <span className="capitalize">{sel.role}</span>
              </p>

              <label className="mt-4 block text-sm font-medium text-royal-900">New password</label>
              <div className="flex gap-2">
                <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={input} />
                <button
                  type="button"
                  onClick={() => setPassword(randomPassword())}
                  title="Generate"
                  className="mt-1 rounded-lg border border-gray-300 px-3 text-royal-700 hover:bg-royal-50"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
              </div>

              {error && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}
              {done && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {done}
                </p>
              )}

              <button
                onClick={() => void reset()}
                disabled={busy}
                className="mt-5 flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Reset password
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
