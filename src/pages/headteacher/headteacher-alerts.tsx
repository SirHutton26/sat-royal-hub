import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BellRing, CheckCircle2, Loader2, MessageSquareText, Smartphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABEL } from '@/lib/headteacher'

type AType = 'all_staff' | 'all_teachers' | 'selected'
interface Person {
  id: string
  full_name: string | null
  username: string | null
  role: string
  phone_number: string | null
}
interface Past {
  id: string
  title: string
  message: string
  created_at: string
  recipient_count: number | null
  push_sent: number | null
  sms_sent: number | null
  sms_failed: number | null
}

async function call<T>(body: object): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke('send-alert', { body })
  if (error) {
    let msg = error.message
    try {
      const j = await (error as unknown as { context: Response }).context.json()
      if (j?.error) msg = j.error
    } catch {
      /* keep generic message */
    }
    return { error: msg }
  }
  if (data?.error) return { error: data.error }
  return { data: data as T }
}

const OPTIONS: { v: AType; label: string; hint: string }[] = [
  { v: 'all_staff', label: 'All staff', hint: 'Teachers, bursar and other staff' },
  { v: 'all_teachers', label: 'All teachers', hint: 'Every active teacher' },
  { v: 'selected', label: 'Choose people', hint: 'Pick who gets it' },
]

export default function HeadteacherAlerts() {
  const { profile } = useAuth()
  const [people, setPeople] = useState<Person[]>([])
  const [type, setType] = useState<AType>('all_staff')
  const [ids, setIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(true)
  const [sms, setSms] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ total: number; withPhone: number } | null>(null)
  const [result, setResult] = useState<{ recipients: number; pushSent: number; smsSent: number; smsFailed: number; noPhone: number } | null>(null)
  const [past, setPast] = useState<Past[]>([])

  const loadPast = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('alerts')
      .select('id, title, message, created_at, recipient_count, push_sent, sms_sent, sms_failed')
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setPast((data ?? []) as Past[])
  }, [profile])

  useEffect(() => {
    void loadPast()
    supabase
      .from('profiles')
      .select('id, full_name, username, role, phone_number')
      .in('role', ['teacher', 'bursar', 'storekeeper', 'staff', 'messenger'])
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setPeople((data ?? []) as Person[]))
  }, [loadPast])

  const audience = { type, ids }
  const smsText = `SAT Royal: ${title} - ${message}`

  async function onReview() {
    setError('')
    setResult(null)
    if (!title.trim() || !message.trim()) return setError('Type a title and a message')
    setBusy(true)
    const r = await call<{ total: number; withPhone: number }>({ action: 'preview', audience })
    setBusy(false)
    if (r.error) return setError(r.error)
    if (!r.data?.total) return setError('There is nobody to send this to')
    setPreview(r.data)
  }

  async function onSend() {
    setBusy(true)
    const r = await call<NonNullable<typeof result>>({ action: 'send', audience, title, message, push, sms })
    setBusy(false)
    setPreview(null)
    if (r.error) return setError(r.error)
    setResult(r.data!)
    setTitle('')
    setMessage('')
    void loadPast()
  }

  const nameOf = (p: Person) => p.full_name || p.username || 'Staff'
  const inp = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-royal-900">Alerts to staff</h1>
      <p className="mt-1 text-sm text-gray-500">Your alert shows on each person's dashboard. You can also send it to their phones and by SMS.</p>

      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-royal-900">Who is it for?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => (
            <button key={o.v} onClick={() => { setType(o.v); setPreview(null) }} className={`rounded-xl border px-3 py-2 text-left text-sm transition ${type === o.v ? 'border-royal-700 bg-royal-700 text-white' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="font-semibold">{o.label}</span>
              <span className={`block text-xs ${type === o.v ? 'text-white/70' : 'text-gray-500'}`}>{o.hint}</span>
            </button>
          ))}
        </div>
        {type === 'selected' && (
          <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-gray-200">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
                <span className="flex-1">{nameOf(p)}<span className="ml-2 text-xs text-gray-400">{ROLE_LABEL[p.role] ?? p.role}</span></span>
                {!p.phone_number && <span className="text-xs text-gray-400">no phone</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <label className="block text-sm font-semibold text-royal-900">Title
          <input value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null) }} maxLength={80} placeholder="e.g. Staff meeting" className={inp} />
        </label>
        <label className="mt-3 block text-sm font-semibold text-royal-900">Message
          <textarea value={message} onChange={(e) => { setMessage(e.target.value); setPreview(null) }} maxLength={500} rows={4} placeholder="Type the alert..." className={inp} />
        </label>
        <p className="mt-1 text-xs text-gray-400">{message.length}/500</p>

        <p className="mt-3 text-sm font-semibold text-royal-900">How should it reach them?</p>
        <div className="mt-2 space-y-2 text-sm">
          <label className="flex items-center gap-2 text-gray-500"><input type="checkbox" checked disabled /> <BellRing className="h-4 w-4" /> Their dashboard (always)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> <Smartphone className="h-4 w-4 text-royal-600" /> Phone notification (for those who installed the app)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> <MessageSquareText className="h-4 w-4 text-royal-600" /> SMS to their phone numbers</label>
        </div>
        {sms && (title || message) && <p className="mt-2 text-xs text-gray-400">SMS: {Math.max(1, Math.ceil(smsText.length / 160))} part(s) each, {smsText.length} characters.</p>}
      </div>

      {error && <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
      {result && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Sent to {result.recipients} staff. {result.pushSent} phone notification(s), {result.smsSent} SMS delivered
            {result.smsFailed ? `, ${result.smsFailed} SMS failed` : ''}
            {result.noPhone ? `, ${result.noPhone} have no phone number saved` : ''}.
          </span>
        </p>
      )}

      <button onClick={onReview} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-royal-700 py-3 text-sm font-semibold text-white hover:bg-royal-800 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Review and send
      </button>

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-royal-900">Sent alerts</h2>
          <ul className="mt-2 space-y-2">
            {past.map((a) => (
              <li key={a.id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-royal-900">{a.title}</p>
                  <span className="shrink-0 text-xs text-gray-400">{new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{a.message}</p>
                <p className="mt-1.5 text-xs text-gray-400">
                  {a.recipient_count ?? 0} staff · {a.push_sent ?? 0} notified · {a.sms_sent ?? 0} SMS{a.sms_failed ? ` (${a.sms_failed} failed)` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-lg font-bold text-royal-900">Send to {preview.total} staff?</p>
            <p className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-800"><b>{title}</b><br />{message}</p>
            <ul className="mt-3 space-y-1 text-sm text-gray-600">
              <li>Dashboard: yes</li>
              <li>Phone notification: {push ? 'yes' : 'no'}</li>
              <li>SMS: {sms ? `yes, to ${preview.withPhone} number(s)${preview.withPhone < preview.total ? ` (${preview.total - preview.withPhone} have no phone saved)` : ''}` : 'no'}</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPreview(null)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Cancel</button>
              <button onClick={onSend} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gold-400 px-4 py-2 text-sm font-bold text-royal-900 disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
