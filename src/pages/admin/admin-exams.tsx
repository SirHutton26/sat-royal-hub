import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Trash2, CalendarClock, GraduationCap, Baby, School } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type GroupKey = 'creche_nursery' | 'kg_basic6' | 'jhs'

interface ExamGroup {
  key: GroupKey
  label: string
  icon: typeof Baby
  color: string
  types: string[]
}

const EXAM_GROUPS: ExamGroup[] = [
  { key: 'creche_nursery', label: 'Creche - Nursery', icon: Baby, color: 'from-pink-500 to-pink-600', types: ['End of Term Exam'] },
  { key: 'kg_basic6', label: 'KG - Basic 6', icon: School, color: 'from-sky-500 to-sky-600', types: ['Mid Term Exam', 'End of Term Exam'] },
  {
    key: 'jhs',
    label: 'JHS (Basic 7-9)',
    icon: GraduationCap,
    color: 'from-violet-500 to-violet-600',
    types: ['Mid Term Exam', 'End of Term Exam', 'Mock Exam', 'Promotional Exam'],
  },
]

const TERMS = ['Term 1', 'Term 2', 'Term 3']

interface ExamSession {
  id: string
  term: string
  start_date: string
  end_date: string
  is_active: boolean
}

const sessionSchema = z
  .object({
    term: z.string().min(1),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
  })
  .refine((d) => d.endDate >= d.startDate, { message: 'End date must be after start date', path: ['endDate'] })
type SessionValues = z.infer<typeof sessionSchema>

function ExamTypeModal({ groupKey, examType, onClose }: { groupKey: GroupKey; examType: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<ExamSession[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SessionValues>({ resolver: zodResolver(sessionSchema), defaultValues: { term: TERMS[0], startDate: '', endDate: '' } })

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('exam_sessions')
      .select('id, term, start_date, end_date, is_active')
      .eq('group_key', groupKey)
      .eq('exam_type', examType)
      .order('start_date', { ascending: false })
    setSessions(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(values: SessionValues) {
    const { error } = await supabase.from('exam_sessions').insert({
      group_key: groupKey,
      exam_type: examType,
      term: values.term,
      start_date: values.startDate,
      end_date: values.endDate,
      is_active: true,
    })
    if (!error) {
      reset({ term: values.term, startDate: '', endDate: '' })
      load()
    }
  }

  async function toggleActive(session: ExamSession) {
    setBusyId(session.id)
    const { error } = await supabase.from('exam_sessions').update({ is_active: !session.is_active }).eq('id', session.id)
    if (!error) await load()
    setBusyId(null)
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this exam session?')) return
    setBusyId(id)
    const { error } = await supabase.from('exam_sessions').delete().eq('id', id)
    if (!error) setSessions((prev) => prev.filter((s) => s.id !== id))
    setBusyId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{examType}</h2>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-400">Not activated yet.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-royal-50/60 px-3 py-2">
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
  const [selected, setSelected] = useState<{ groupKey: GroupKey; examType: string } | null>(null)
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
                return (
                  <button
                    key={type}
                    onClick={() => setSelected({ groupKey: group.key, examType: type })}
                    className={`rounded-xl bg-gradient-to-br ${group.color} p-4 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md`}
                  >
                    <p className="text-sm font-semibold">{type}</p>
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
        <ExamTypeModal groupKey={selected.groupKey} examType={selected.examType} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}