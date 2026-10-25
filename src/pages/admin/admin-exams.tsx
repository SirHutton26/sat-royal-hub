import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  X,
  Trash2,
  CalendarClock,
  GraduationCap,
  Baby,
  School,
  Pencil,
  ChevronRight,
  Info,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

type GroupKey = 'creche_nursery' | 'kg_basic6' | 'jhs'

interface ExamGroup {
  key: GroupKey
  label: string
  blurb: string
  icon: typeof Baby
  color: string
  types: string[]
  // classes.level_group values that belong to this exam group
  levelGroups: string[]
  // exam types that only some classes write (the admin picks which)
  selectiveTypes: string[]
}

const EXAM_GROUPS: ExamGroup[] = [
  {
    key: 'creche_nursery',
    label: 'Creche - Nursery',
    blurb: 'Creche and Nursery classes',
    icon: Baby,
    color: 'from-pink-500 to-pink-600',
    types: ['End of Term Exam'],
    levelGroups: ['creche', 'nursery'],
    selectiveTypes: [],
  },
  {
    key: 'kg_basic6',
    label: 'KG - Basic 6',
    blurb: 'Kindergarten to Basic 6',
    icon: School,
    color: 'from-sky-500 to-sky-600',
    types: ['Mid Term Exam', 'End of Term Exam'],
    levelGroups: ['kg', 'lower_primary', 'upper_primary'],
    selectiveTypes: [],
  },
  {
    key: 'jhs',
    label: 'JHS (Basic 7-9)',
    blurb: 'Junior High School',
    icon: GraduationCap,
    color: 'from-violet-500 to-violet-600',
    types: ['Mid Term Exam', 'End of Term Exam', 'Mock Exam', 'Promotional Exam'],
    levelGroups: ['jhs'],
    selectiveTypes: ['Mock Exam', 'Promotional Exam'],
  },
]

const TERMS = ['Term 1', 'Term 2', 'Term 3']

interface ExamSession {
  id: string
  group_key: GroupKey
  exam_type: string
  term: string
  start_date: string
  end_date: string
  is_active: boolean
  class_ids: string[] | null // null = every class in the group
}

interface ClassOption {
  id: string
  name: string
}

/* ---------- status helpers ---------- */

// Same "today" the teacher portal uses, so the status shown here is exactly what teachers see.
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

type Status = 'open' | 'upcoming' | 'ended' | 'off'

function statusOf(s: ExamSession, today: string): Status {
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

const STATUS_RANK: Record<Status, number> = { open: 0, upcoming: 1, ended: 2, off: 3 }

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const dayDiff = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000)

function fmt(iso: string, withYear = false) {
  return toDate(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

function dateRange(s: ExamSession) {
  const sameYear = s.start_date.slice(0, 4) === s.end_date.slice(0, 4)
  return sameYear
    ? `${fmt(s.start_date)} to ${fmt(s.end_date)}, ${s.end_date.slice(0, 4)}`
    : `${fmt(s.start_date, true)} to ${fmt(s.end_date, true)}`
}

function statusHint(s: ExamSession, status: Status, today: string) {
  if (status === 'upcoming') {
    const d = dayDiff(today, s.start_date)
    return d === 1 ? 'Opens tomorrow' : `Opens in ${d} days`
  }
  if (status === 'open') {
    const d = dayDiff(today, s.end_date)
    return d === 0 ? 'Closes today' : d === 1 ? 'Closes tomorrow' : `Closes in ${d} days`
  }
  if (status === 'ended') return 'The window has ended'
  return 'Teachers cannot see this exam'
}

/** The session that best describes an exam type: open, else next upcoming, else the latest one. */
function headline(list: ExamSession[], today: string): ExamSession | undefined {
  return [...list].sort((a, b) => {
    const sa = statusOf(a, today)
    const sb = statusOf(b, today)
    if (sa !== sb) return STATUS_RANK[sa] - STATUS_RANK[sb]
    return sa === 'open' || sa === 'upcoming' ? a.start_date.localeCompare(b.start_date) : b.start_date.localeCompare(a.start_date)
  })[0]
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

const sessionSchema = z
  .object({
    term: z.string().min(1),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
  })
  .refine((d) => d.endDate >= d.startDate, { message: 'End date must be after start date', path: ['endDate'] })
type SessionValues = z.infer<typeof sessionSchema>

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function ClassPicker({
  classes,
  selected,
  onChange,
  disabled,
}: {
  classes: ClassOption[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  if (classes.length === 0) {
    return <p className="text-xs text-red-500">No classes found for this level yet.</p>
  }

  const allSelected = selected.length === classes.length

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id])
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {selected.length} of {classes.length} selected
        </span>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : classes.map((c) => c.id))}
          disabled={disabled}
          className="text-xs font-medium text-royal-600 hover:underline disabled:opacity-60"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {classes.map((c) => {
          const checked = selected.includes(c.id)
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                checked ? 'border-royal-400 bg-royal-50 text-royal-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} disabled={disabled} className="h-4 w-4" />
              {c.name}
            </label>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- side drawer for one exam type ---------- */

function ExamTypeDrawer({
  group,
  examType,
  sessions,
  today,
  onChanged,
  onClose,
}: {
  group: ExamGroup
  examType: string
  sessions: ExamSession[]
  today: string
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const selective = group.selectiveTypes.includes(examType)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [newClassIds, setNewClassIds] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editClassIds, setEditClassIds] = useState<string[]>([])
  const [editError, setEditError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SessionValues>({ resolver: zodResolver(sessionSchema), defaultValues: { term: TERMS[0], startDate: '', endDate: '' } })

  useEffect(() => {
    if (!selective) return
    supabase
      .from('classes')
      .select('id, name')
      .in('level_group', group.levelGroups)
      .then(({ data }) => {
        const list = ((data ?? []) as ClassOption[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        setClasses(list)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onSubmit(values: SessionValues) {
    setFormError(null)
    if (selective && newClassIds.length === 0) {
      setFormError('Select at least one class that will write this exam.')
      return
    }

    const { error } = await supabase.from('exam_sessions').insert({
      group_key: group.key,
      exam_type: examType,
      term: values.term,
      start_date: values.startDate,
      end_date: values.endDate,
      is_active: true,
      class_ids: selective ? newClassIds : null,
    })

    if (error) {
      setFormError(error.message)
      return
    }

    reset({ term: values.term, startDate: '', endDate: '' })
    setNewClassIds([])
    await onChanged()
  }

  async function toggleActive(session: ExamSession) {
    setBusyId(session.id)
    setActionError(null)
    const { error } = await supabase.from('exam_sessions').update({ is_active: !session.is_active }).eq('id', session.id)
    if (error) setActionError(error.message)
    else await onChanged()
    setBusyId(null)
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this exam session? Scores already entered for it may be lost.')) return
    setBusyId(id)
    setActionError(null)
    const { error } = await supabase.from('exam_sessions').delete().eq('id', id)
    if (error) setActionError(error.message)
    else await onChanged()
    setBusyId(null)
  }

  function startEditClasses(s: ExamSession) {
    setEditError(null)
    setEditingId(s.id)
    setEditClassIds(s.class_ids ?? [])
  }

  async function saveClasses(id: string) {
    if (editClassIds.length === 0) {
      setEditError('Select at least one class.')
      return
    }
    setBusyId(id)
    setEditError(null)
    const { data, error } = await supabase.from('exam_sessions').update({ class_ids: editClassIds }).eq('id', id).select('id')
    setBusyId(null)

    if (error || !data || data.length === 0) {
      setEditError(error?.message ?? 'Could not update. Check your permissions.')
      return
    }
    setEditingId(null)
    await onChanged()
  }

  const classNameById = new Map(classes.map((c) => [c.id, c.name]))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-royal-900/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={examType}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-gray-50 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 bg-white px-5 py-4">
          <div className={`rounded-xl bg-gradient-to-br ${group.color} p-2 text-white`}>
            <group.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-royal-900">{examType}</h2>
            <p className="text-xs text-gray-500">
              {group.label} ·{' '}
              {selective ? 'only the classes you choose write this exam' : 'applies to all classes in this level'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <p className="flex items-start gap-2 rounded-lg bg-royal-50 px-3 py-2.5 text-xs text-royal-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-royal-600" />
            Teachers can enter scores only while a window is switched on and today falls between its start and end dates.
          </p>

          {actionError && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {actionError}
            </p>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scheduled windows</h3>
            <div className="mt-2 space-y-3">
              {sessions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-400">
                  Nothing scheduled yet. Add a window below.
                </p>
              ) : (
                sessions.map((s) => {
                  const st = statusOf(s, today)
                  return (
                    <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-royal-900">{s.term}</p>
                            <StatusBadge status={st} />
                          </div>
                          <p className="mt-1 text-xs text-gray-600">{dateRange(s)}</p>
                          <p className="text-xs text-gray-400">{statusHint(s, st, today)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
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
                            onClick={() => deleteSession(s.id)}
                            disabled={busyId === s.id}
                            aria-label="Delete window"
                            className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {selective &&
                        (editingId === s.id ? (
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <ClassPicker classes={classes} selected={editClassIds} onChange={setEditClassIds} disabled={busyId === s.id} />
                            {editError && <p className="mt-2 text-xs text-red-600">{editError}</p>}
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => setEditingId(null)}
                                disabled={busyId === s.id}
                                className="flex-1 rounded-md border border-gray-300 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => saveClasses(s.id)}
                                disabled={busyId === s.id}
                                className="flex-1 rounded-md bg-royal-600 py-1.5 text-xs font-semibold text-white hover:bg-royal-700 disabled:opacity-60"
                              >
                                {busyId === s.id ? 'Saving...' : 'Save classes'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex items-start justify-between gap-2 border-t border-gray-100 pt-3">
                            <div className="flex flex-wrap gap-1">
                              {s.class_ids === null ? (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  All classes (not restricted)
                                </span>
                              ) : s.class_ids.length === 0 ? (
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">No classes</span>
                              ) : (
                                s.class_ids.map((id) => (
                                  <span key={id} className="rounded-full bg-royal-100 px-2 py-0.5 text-[11px] font-medium text-royal-700">
                                    {classNameById.get(id) ?? 'Unknown class'}
                                  </span>
                                ))
                              )}
                            </div>
                            <button
                              onClick={() => startEditClasses(s)}
                              className="flex shrink-0 items-center gap-1 text-xs font-medium text-royal-600 hover:underline"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit classes
                            </button>
                          </div>
                        ))}
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Schedule a new window</h3>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div>
                <label className="block text-sm font-medium text-royal-900">Term</label>
                <select {...register('term')} className={inputCls}>
                  {TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-royal-900">Start date</label>
                  <input type="date" {...register('startDate')} className={inputCls} />
                  {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-royal-900">End date</label>
                  <input type="date" {...register('endDate')} className={inputCls} />
                  {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate.message}</p>}
                </div>
              </div>

              {selective && (
                <div>
                  <label className="block text-sm font-medium text-royal-900">Classes writing this exam</label>
                  <div className="mt-2">
                    <ClassPicker classes={classes} selected={newClassIds} onChange={setNewClassIds} disabled={isSubmitting} />
                  </div>
                </div>
              )}

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-royal-600 py-2.5 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
              >
                <CalendarClock className="h-4 w-4" />
                {isSubmitting ? 'Activating...' : 'Activate for this term'}
              </button>
            </form>
          </section>
        </div>
      </aside>
    </div>
  )
}

/* ---------- page ---------- */

export default function AdminExams() {
  const [sessions, setSessions] = useState<ExamSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ group: ExamGroup; examType: string } | null>(null)
  const today = todayISO()

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('exam_sessions')
      .select('id, group_key, exam_type, term, start_date, end_date, is_active, class_ids')
      .order('start_date', { ascending: false })
    if (err) setError(err.message)
    else {
      setError(null)
      setSessions((data as ExamSession[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    let open = 0
    let upcoming = 0
    for (const s of sessions) {
      const st = statusOf(s, today)
      if (st === 'open') open++
      else if (st === 'upcoming') upcoming++
    }
    const unscheduled = EXAM_GROUPS.flatMap((g) => g.types.map((t) => ({ g, t }))).filter(
      ({ g, t }) =>
        !sessions.some((s) => {
          if (s.group_key !== g.key || s.exam_type !== t) return false
          const st = statusOf(s, today)
          return st === 'open' || st === 'upcoming'
        }),
    ).length
    return { open, upcoming, unscheduled }
  }, [sessions, today])

  const selectedSessions = selected
    ? sessions.filter((s) => s.group_key === selected.group.key && s.exam_type === selected.examType)
    : []

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-royal-900">Exams</h1>
      <p className="mt-1 text-sm text-gray-500">
        Choose when each exam opens for score entry. Teachers see an exam only between its start and end dates.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { label: 'Open for scores now', value: stats.open, dot: 'bg-emerald-500' },
          { label: 'Opening soon', value: stats.upcoming, dot: 'bg-amber-500' },
          { label: 'Not scheduled', value: stats.unscheduled, dot: 'bg-gray-400' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold text-royal-900">{loading ? '–' : t.value}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
              {t.label}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Could not load exams: {error}
          </span>
          <button onClick={() => void load()} className="flex items-center gap-1.5 text-xs font-semibold hover:underline">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {EXAM_GROUPS.map((group) => (
          <section key={group.key} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <header className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
              <div className={`rounded-xl bg-gradient-to-br ${group.color} p-2 text-white`}>
                <group.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-royal-900">{group.label}</h2>
                <p className="text-xs text-gray-500">{group.blurb}</p>
              </div>
            </header>

            <ul className="divide-y divide-gray-100">
              {group.types.map((type) => {
                const list = sessions.filter((s) => s.group_key === group.key && s.exam_type === type)
                const head = headline(list, today)
                const st = head ? statusOf(head, today) : null
                const selective = group.selectiveTypes.includes(type)
                const scope = !selective
                  ? 'All classes'
                  : head?.class_ids == null
                    ? head
                      ? 'All classes (not restricted)'
                      : 'Selected classes only'
                    : `${head.class_ids.length} class${head.class_ids.length === 1 ? '' : 'es'} chosen`

                return (
                  <li key={type}>
                    <button
                      onClick={() => setSelected({ group, examType: type })}
                      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition hover:bg-royal-50/50"
                    >
                      <div className="min-w-0 flex-1 basis-44">
                        <p className="text-sm font-semibold text-royal-900">{type}</p>
                        <p className="text-xs text-gray-500">{scope}</p>
                      </div>

                      <div className="min-w-0 flex-1 basis-60">
                        {loading ? (
                          <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
                        ) : head && st ? (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={st} />
                              <span className="text-xs text-gray-500">{statusHint(head, st, today)}</span>
                              {list.length > 1 && <span className="text-[11px] text-gray-400">+{list.length - 1} more</span>}
                            </div>
                            <p className="mt-1 text-xs text-gray-600">
                              {head.term} · {dateRange(head)}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-gray-400">Not scheduled yet</p>
                        )}
                      </div>

                      <span className="flex items-center gap-0.5 text-xs font-semibold text-royal-600">
                        Manage <ChevronRight className="h-4 w-4" />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {selected && (
        <ExamTypeDrawer
          group={selected.group}
          examType={selected.examType}
          sessions={selectedSessions}
          today={today}
          onChanged={load}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}