import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, ClipboardCheck, CalendarClock, GraduationCap, Info, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AdminCassScores from '@/pages/admin/admin-cass-scores'

interface CassSession {
  id: string
  academic_year: string
  start_date: string
  end_date: string
  is_active: boolean
}

/* ---------- status helpers (same rules the teacher portal applies) ---------- */

const todayISO = () => new Date().toISOString().slice(0, 10)

type Status = 'open' | 'upcoming' | 'ended' | 'off'

function statusOf(s: CassSession, today: string): Status {
  if (!s.is_active) return 'off'
  if (today < s.start_date) return 'upcoming'
  if (today > s.end_date) return 'ended'
  return 'open'
}

const STATUS_STYLE: Record<Status, { label: string; badge: string; dot: string }> = {
  open: { label: 'Open now', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  upcoming: { label: 'Upcoming', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  ended: { label: 'Ended', badge: 'bg-gray-100 text-gray-600 ring-gray-200', dot: 'bg-gray-400' },
  off: { label: 'Switched off', badge: 'bg-red-50 text-red-600 ring-red-200', dot: 'bg-red-400' },
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const dayDiff = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000)
const fmt = (iso: string) =>
  toDate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function statusHint(s: CassSession, status: Status, today: string) {
  if (status === 'upcoming') {
    const d = dayDiff(today, s.start_date)
    return d === 1 ? 'Opens tomorrow' : `Opens in ${d} days`
  }
  if (status === 'open') {
    const d = dayDiff(today, s.end_date)
    return d === 0 ? 'Closes today' : d === 1 ? 'Closes tomorrow' : `Closes in ${d} days`
  }
  if (status === 'ended') return 'The window has ended'
  return 'Teachers cannot see this CASS'
}

function StatusBadge({ status }: { status: Status }) {
  const st = STATUS_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${st.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {st.label}
    </span>
  )
}

/* ---------- form ---------- */

const schema = z
  .object({
    academicYear: z.string().min(1, 'Choose the academic year'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
  })
  .refine((d) => d.endDate >= d.startDate, { message: 'End date must be after start date', path: ['endDate'] })
type Values = z.infer<typeof schema>

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/** e.g. in Nov 2026: 2025/2026, 2026/2027, 2027/2028 */
function academicYearOptions() {
  const y = new Date().getFullYear()
  return [y - 1, y, y + 1].map((n) => `${n}/${n + 1}`)
}

/* ---------- page ---------- */

export default function AdminCass() {
  const [sessions, setSessions] = useState<CassSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [basic9, setBasic9] = useState<string[] | null>(null)
  const [viewing, setViewing] = useState<CassSession | null>(null)
  const today = todayISO()
  const yearOptions = useMemo(academicYearOptions, [])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { academicYear: yearOptions[1], startDate: '', endDate: '' },
  })

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('cass_sessions')
      .select('id, academic_year, start_date, end_date, is_active')
      .order('start_date', { ascending: false })
    if (err) setError(err.message)
    else {
      setError(null)
      setSessions((data as CassSession[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Which classes CASS will apply to (Basic 9 only), so the admin can see it is set up
  useEffect(() => {
    supabase
      .from('classes')
      .select('name')
      .eq('level_group', 'jhs')
      .then(({ data }) => {
        const names = ((data ?? []) as { name: string }[]).map((c) => c.name).filter((n) => /(basic|class|b)\s*-?\s*9\b/i.test(n))
        setBasic9(names)
      })
  }, [])

  async function onSubmit(values: Values) {
    setFormError(null)
    const { error: err } = await supabase.from('cass_sessions').insert({
      academic_year: values.academicYear,
      start_date: values.startDate,
      end_date: values.endDate,
      is_active: true,
    })
    if (err) {
      setFormError(
        err.code === '23505' ? `CASS for ${values.academicYear} already exists. Edit or delete it below.` : err.message,
      )
      return
    }
    reset({ academicYear: values.academicYear, startDate: '', endDate: '' })
    await load()
  }

  async function toggleActive(s: CassSession) {
    setBusyId(s.id)
    setActionError(null)
    const { error: err } = await supabase.from('cass_sessions').update({ is_active: !s.is_active }).eq('id', s.id)
    if (err) setActionError(err.message)
    else await load()
    setBusyId(null)
  }

  async function remove(s: CassSession) {
    if (!confirm(`Delete CASS ${s.academic_year}? All CASS scores teachers entered for it will be lost.`)) return
    setBusyId(s.id)
    setActionError(null)
    const { error: err } = await supabase.from('cass_sessions').delete().eq('id', s.id)
    if (err) setActionError(err.message)
    else await load()
    setBusyId(null)
  }

  if (viewing) return <AdminCassScores session={viewing} onBack={() => setViewing(null)} />

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 p-2 text-white">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-royal-900">CASS</h1>
          <p className="text-sm text-gray-500">Continuous Assessment Score Sheet (Year 1 and Year 2 scores)</p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg bg-royal-50 px-3 py-2.5 text-xs text-royal-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-royal-600" />
        <span>
          Once a CASS window is created and switched on, it appears on the <strong>Exams</strong> page of the JHS subject teachers who teach
          Basic 9. Each teacher enters the Year 1 and Year 2 CASS scores for their own subject only, between the start and end dates.
        </span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <GraduationCap className="h-4 w-4 text-violet-600" />
        <span className="font-medium text-royal-900">Applies to:</span>
        {basic9 === null ? (
          <span className="text-gray-400">checking...</span>
        ) : basic9.length === 0 ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600">
            No Basic 9 class found. Create it under Class first.
          </span>
        ) : (
          basic9.map((n) => (
            <span key={n} className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-700">
              {n}
            </span>
          ))
        )}
      </div>

      {error && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Could not load CASS: {error}
          </span>
          <button onClick={() => void load()} className="flex items-center gap-1.5 text-xs font-semibold hover:underline">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Create CASS</h2>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-royal-900">Academic year</label>
            <select {...register('academicYear')} className={inputCls}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {errors.academicYear && <p className="mt-1 text-xs text-red-600">{errors.academicYear.message}</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-royal-900">Teachers can start from</label>
              <input type="date" {...register('startDate')} className={inputCls} />
              {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-royal-900">Teachers can enter until</label>
              <input type="date" {...register('endDate')} className={inputCls} />
              {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate.message}</p>}
            </div>
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-royal-600 py-2.5 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            <CalendarClock className="h-4 w-4" />
            {isSubmitting ? 'Creating...' : 'Create CASS'}
          </button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">CASS windows</h2>
        {actionError && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {actionError}
          </p>
        )}
        <div className="mt-2 space-y-3">
          {loading ? (
            <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ) : sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-400">
              No CASS created yet. Create one above.
            </p>
          ) : (
            sessions.map((s) => {
              const st = statusOf(s, today)
              return (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-royal-900">CASS {s.academic_year}</p>
                      <StatusBadge status={st} />
                    </div>
                    <p className="mt-1 text-xs text-gray-600">
                      {fmt(s.start_date)} to {fmt(s.end_date)}
                    </p>
                    <p className="text-xs text-gray-400">{statusHint(s, st, today)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setViewing(s)}
                      className="rounded-md border border-royal-200 px-2.5 py-1 text-xs font-semibold text-royal-700 hover:bg-royal-50"
                    >
                      View scores
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.is_active}
                      aria-label={s.is_active ? 'Switch off' : 'Switch on'}
                      title={s.is_active ? 'Switch off' : 'Switch on'}
                      onClick={() => toggleActive(s)}
                      disabled={busyId === s.id}
                      className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${s.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          s.is_active ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      disabled={busyId === s.id}
                      aria-label="Delete CASS"
                      className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
