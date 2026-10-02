import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Trash2, CalendarClock, GraduationCap, Baby, School, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type GroupKey = 'creche_nursery' | 'kg_basic6' | 'jhs'

interface ExamGroup {
  key: GroupKey
  label: string
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
    icon: Baby,
    color: 'from-pink-500 to-pink-600',
    types: ['End of Term Exam'],
    levelGroups: ['creche', 'nursery'],
    selectiveTypes: [],
  },
  {
    key: 'kg_basic6',
    label: 'KG - Basic 6',
    icon: School,
    color: 'from-sky-500 to-sky-600',
    types: ['Mid Term Exam', 'End of Term Exam'],
    levelGroups: ['kg', 'lower_primary', 'upper_primary'],
    selectiveTypes: [],
  },
  {
    key: 'jhs',
    label: 'JHS (Basic 7-9)',
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

const sessionSchema = z
  .object({
    term: z.string().min(1),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
  })
  .refine((d) => d.endDate >= d.startDate, { message: 'End date must be after start date', path: ['endDate'] })
type SessionValues = z.infer<typeof sessionSchema>

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
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.id)}
                disabled={disabled}
                className="h-4 w-4"
              />
              {c.name}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ExamTypeModal({ group, examType, onClose }: { group: ExamGroup; examType: string; onClose: () => void }) {
  const groupKey = group.key
  const selective = group.selectiveTypes.includes(examType)

  const [sessions, setSessions] = useState<ExamSession[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  async function load() {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('exam_sessions')
      .select('id, term, start_date, end_date, is_active, class_ids')
      .eq('group_key', groupKey)
      .eq('exam_type', examType)
      .order('start_date', { ascending: false })
    if (error) setLoadError(error.message)
    setSessions((data as ExamSession[]) ?? [])
    setLoading(false)
  }

  async function loadClasses() {
    const { data } = await supabase.from('classes').select('id, name').in('level_group', group.levelGroups)
    const list = ((data ?? []) as ClassOption[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    setClasses(list)
  }

  useEffect(() => {
    load()
    if (selective) loadClasses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(values: SessionValues) {
    setFormError(null)
    if (selective && newClassIds.length === 0) {
      setFormError('Select at least one class that will write this exam.')
      return
    }

    const { error } = await supabase.from('exam_sessions').insert({
      group_key: groupKey,
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
    load()
  }

  async function toggleActive(session: ExamSession) {
    setBusyId(session.id)
    const { error } = await supabase.from('exam_sessions').update({ is_active: !session.is_active }).eq('id', session.id)
    if (!error) await load()
    setBusyId(null)
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this exam session? Scores already entered for it may be lost.')) return
    setBusyId(id)
    const { error } = await supabase.from('exam_sessions').delete().eq('id', id)
    if (!error) setSessions((prev) => prev.filter((s) => s.id !== id))
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
    const { data, error } = await supabase
      .from('exam_sessions')
      .update({ class_ids: editClassIds })
      .eq('id', id)
      .select('id')
    setBusyId(null)

    if (error || !data || data.length === 0) {
      setEditError(error?.message ?? 'Could not update. Check your permissions.')
      return
    }
    setEditingId(null)
    await load()
  }

  const classNameById = new Map(classes.map((c) => [c.id, c.name]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{examType}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          {selective
            ? 'Only the classes you choose will write this exam.'
            : `Applies to all classes in ${group.label}.`}
        </p>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : loadError ? (
            <p className="text-sm text-red-600">Could not load sessions: {loadError}</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-400">Not activated yet.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="rounded-lg bg-royal-50/60 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-royal-900">{s.term}</p>
                    <p className="text-xs text-gray-500">
                      {s.start_date} → {s.end_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleActive(s)}
                      disabled={busyId === s.id}
                      className={`rounded-md px-2 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                        s.is_active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {s.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      disabled={busyId === s.id}
                      className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {selective &&
                  (editingId === s.id ? (
                    <div className="mt-3 border-t border-royal-100 pt-3">
                      <ClassPicker
                        classes={classes}
                        selected={editClassIds}
                        onChange={setEditClassIds}
                        disabled={busyId === s.id}
                      />
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
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {s.class_ids === null ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            All classes (not restricted)
                          </span>
                        ) : s.class_ids.length === 0 ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                            No classes
                          </span>
                        ) : (
                          s.class_ids.map((id) => (
                            <span
                              key={id}
                              className="rounded-full bg-royal-100 px-2 py-0.5 text-[11px] font-medium text-royal-700"
                            >
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
            ))
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <div>
            <label className="block text-sm font-medium text-royal-900">Term</label>
            <select
              {...register('term')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
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
              <input
                type="date"
                {...register('startDate')}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              />
              {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-royal-900">End date</label>
              <input
                type="date"
                {...register('endDate')}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              />
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
            className="flex w-full items-center justify-center gap-2 rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            <CalendarClock className="h-4 w-4" />
            {isSubmitting ? 'Activating...' : 'Activate for this term'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminExams() {
  const [selected, setSelected] = useState<{ group: ExamGroup; examType: string } | null>(null)
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    async function loadCounts() {
      const { data } = await supabase.from('exam_sessions').select('group_key, exam_type, is_active').eq('is_active', true)
      const counts: Record<string, number> = {}
      for (const row of data ?? []) {
        const key = `${row.group_key}:${row.exam_type}`
        counts[key] = (counts[key] ?? 0) + 1
      }
      setActiveCounts(counts)
    }
    loadCounts()
  }, [selected])

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Exams</h1>
      <p className="mt-1 text-sm text-gray-500">
        Activate an exam type for a term so teachers can enter scores during that window.
      </p>

      <div className="mt-6 space-y-8">
        {EXAM_GROUPS.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2">
              <div className={`rounded-lg bg-gradient-to-br ${group.color} p-1.5 text-white`}>
                <group.icon className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-royal-900">{group.label}</h2>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {group.types.map((type) => {
                const count = activeCounts[`${group.key}:${type}`] ?? 0
                const isSelective = group.selectiveTypes.includes(type)
                return (
                  <button
                    key={type}
                    onClick={() => setSelected({ group, examType: type })}
                    className={`rounded-xl bg-gradient-to-br ${group.color} p-4 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md`}
                  >
                    <p className="text-sm font-semibold">{type}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-white/80">
                      {isSelective ? 'Selected classes only' : 'All classes'}
                    </p>
                    <p className="mt-2 text-2xl font-bold">{count}</p>
                    <p className="text-xs text-white/80">{count === 1 ? 'active term' : 'active terms'}</p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <ExamTypeModal group={selected.group} examType={selected.examType} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}