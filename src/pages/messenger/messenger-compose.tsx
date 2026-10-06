import { useEffect, useState } from 'react'
import { Loader2, Search, Send, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type AType = 'all_parents' | 'class_parents' | 'students' | 'all_teachers' | 'all_staff' | 'teachers' | 'numbers'
const OPTIONS: { type: AType; label: string; hint: string }[] = [
  { type: 'all_parents', label: 'All parents', hint: 'Every active student\'s guardian' },
  { type: 'class_parents', label: 'Parents of a class', hint: 'Pick a class' },
  { type: 'students', label: 'Individual parents', hint: 'Search by student name' },
  { type: 'all_teachers', label: 'All teachers', hint: 'Every active teacher' },
  { type: 'all_staff', label: 'All staff', hint: 'Teachers, bursar and other staff' },
  { type: 'teachers', label: 'Selected teachers', hint: 'Pick teachers' },
  { type: 'numbers', label: 'Typed numbers', hint: 'Paste any phone numbers' },
]
interface Meta {
  classes: { id: string; name: string }[]
  teachers: { id: string; name: string; hasPhone: boolean }[]
  balance: number | null
}
interface Found {
  id: string
  name: string
  className: string
  hasPhone: boolean
}

function segments(text: string) {
  if (!text) return { chars: 0, parts: 0 }
  const uni = /[^\x00-\x7F]/.test(text)
  const [one, multi] = uni ? [70, 67] : [160, 153]
  return { chars: text.length, parts: text.length <= one ? 1 : Math.ceil(text.length / multi) }
}

async function call<T>(body: object): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke('send-bulk-sms', { body })
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

export default function MessengerCompose() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [type, setType] = useState<AType>('all_parents')
  const [classId, setClassId] = useState('')
  const [picked, setPicked] = useState<Found[]>([])
  const [teacherIds, setTeacherIds] = useState<string[]>([])
  const [numbers, setNumbers] = useState('')
  const [gender, setGender] = useState<'' | 'male' | 'female'>('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ total: number; noPhone: number; noGender: number; sample: string[] } | null>(null)
  const [result, setResult] = useState<{ total: number; sent: number; failed: number } | null>(null)

  useEffect(() => {
    call<Meta>({ action: 'meta' }).then((r) => r.data && setMeta(r.data))
  }, [])

  useEffect(() => {
    if (type !== 'students' || q.trim().length < 2) return setFound([])
    const t = setTimeout(async () => {
      const r = await call<{ students: Found[] }>({ action: 'search', q })
      setFound(r.data?.students ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [q, type])

  const genderApplies = ['all_parents', 'class_parents', 'all_teachers', 'all_staff'].includes(type)
  const parentGroup = type === 'all_parents' || type === 'class_parents'
  const audience = {
    type,
    class_id: classId || undefined,
    student_ids: picked.map((p) => p.id),
    teacher_ids: teacherIds,
    numbers,
    gender: genderApplies ? gender || undefined : undefined,
  }
  const seg = segments(message)

  async function onPreview() {
    setError('')
    setResult(null)
    if (!message.trim()) return setError('Type a message first')
    setBusy(true)
    const r = await call<{ total: number; noPhone: number; noGender: number; sample: string[] }>({ action: 'preview', audience })
    setBusy(false)
    if (r.error) return setError(r.error)
    if (!r.data?.total) return setError('No valid phone numbers for this selection')
    setPreview(r.data)
  }

  async function onSend() {
    setBusy(true)
    const r = await call<{ total: number; sent: number; failed: number }>({ action: 'send', audience, message })
    setBusy(false)
    setPreview(null)
    if (r.error) return setError(r.error)
    setResult(r.data!)
    if (r.data!.failed === 0) setMessage('')
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-royal-900">Send SMS</h1>
      <p className="mt-1 text-sm text-gray-500">
        Text parents and teachers.{meta?.balance != null && <> SMS credit: <b>{meta.balance}</b></>}
      </p>

      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-royal-900">Send to</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button
              key={o.type}
              onClick={() => {
                setType(o.type)
                setPreview(null)
              }}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                type === o.type ? 'border-royal-700 bg-royal-700 text-white' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="font-semibold">{o.label}</span>
              <span className={`block text-xs ${type === o.type ? 'text-white/70' : 'text-gray-500'}`}>{o.hint}</span>
            </button>
          ))}
        </div>


        {genderApplies && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500">Limit to</p>
            <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-gray-200 text-sm">
              {([
                ['', 'Everyone'],
                ['male', parentGroup ? "Boys' parents" : 'Male'],
                ['female', parentGroup ? "Girls' parents" : 'Female'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => {
                    setGender(v)
                    setPreview(null)
                  }}
                  className={`px-3 py-1.5 font-medium transition ${gender === v ? 'bg-royal-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === 'class_parents' && (
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Choose a class...</option>
            {meta?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {type === 'students' && (
          <div className="mt-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student name..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" />
            </div>
            {found.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                {found.filter((f) => !picked.some((p) => p.id === f.id)).map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => {
                        setPicked([...picked, f])
                        setQ('')
                        setFound([])
                      }}
                      className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <span>{f.name}</span>
                      <span className="text-xs text-gray-500">{f.className}{!f.hasPhone && ' - no phone'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-royal-50 px-2.5 py-1 text-xs font-medium text-royal-800">
                  {p.name}
                  <button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label="Remove">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {type === 'teachers' && (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
            {meta?.teachers.map((t) => (
              <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={teacherIds.includes(t.id)}
                  onChange={(e) => setTeacherIds(e.target.checked ? [...teacherIds, t.id] : teacherIds.filter((x) => x !== t.id))}
                />
                <span className="flex-1">{t.name}</span>
                {!t.hasPhone && <span className="text-xs text-gray-500">no phone</span>}
              </label>
            ))}
          </div>
        )}

        {type === 'numbers' && (
          <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={3} placeholder="0241234567, 0551234567 ..." className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-royal-900">Message</p>
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value)
            setPreview(null)
          }}
          rows={5}
          maxLength={612}
          placeholder="Type your message..."
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
          <span>
            {seg.chars} characters, {seg.parts} SMS per person
          </span>
          <button onClick={() => setMessage(message + (type.includes('teacher') ? '{teacher}' : '{student}'))} className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
            + insert {type.includes('teacher') ? '{teacher}' : '{student}'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {result && (
        <p className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${result.failed ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Sent to {result.sent} of {result.total} numbers{result.failed ? `. ${result.failed} failed - see History.` : '.'}
        </p>
      )}

      <button onClick={onPreview} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-royal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Review and send
      </button>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-lg font-bold text-royal-900">Send to {preview.total} number{preview.total === 1 ? '' : 's'}?</p>
            {preview.noGender > 0 && (
              <p className="mt-1 text-sm text-amber-700">{preview.noGender} left out because their gender is not set.</p>
            )}
            {preview.noPhone > 0 && <p className="mt-1 text-sm text-amber-700">{preview.noPhone} skipped (no valid phone number).</p>}
            <p className="mt-2 text-xs text-gray-500">e.g. {preview.sample.join(', ')}</p>
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{message}</p>
            <p className="mt-2 text-xs text-gray-500">About {preview.total * seg.parts} SMS credits.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPreview(null)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">
                Cancel
              </button>
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
