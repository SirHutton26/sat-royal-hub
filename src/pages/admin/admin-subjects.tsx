import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Trash2, Pencil, Check, BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type LevelGroup = 'creche' | 'nursery' | 'kg' | 'lower_primary' | 'upper_primary' | 'jhs'

interface GroupDef {
  key: LevelGroup
  label: string
  color: string
}

const LEVEL_GROUPS: GroupDef[] = [
  { key: 'creche', label: 'Creche', color: 'from-pink-500 to-pink-600' },
  { key: 'nursery', label: 'Nursery', color: 'from-orange-500 to-orange-600' },
  { key: 'kg', label: 'KG', color: 'from-amber-500 to-amber-600' },
  { key: 'lower_primary', label: 'Lower Primary (Basic 1–3)', color: 'from-emerald-500 to-emerald-600' },
  { key: 'upper_primary', label: 'Upper Primary (Basic 4–6)', color: 'from-sky-500 to-sky-600' },
  { key: 'jhs', label: 'JHS (Basic 7–9)', color: 'from-violet-500 to-violet-600' },
]

interface Subject {
  id: string
  name: string
}

const subjectSchema = z.object({ name: z.string().trim().min(1, 'Subject name is required') })
type SubjectValues = z.infer<typeof subjectSchema>

function GroupSubjectsModal({ group, onClose }: { group: GroupDef; onClose: () => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubjectValues>({ resolver: zodResolver(subjectSchema) })

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('subjects')
      .select('id, name')
      .eq('level_group', group.key)
      .order('name')
    setSubjects(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(values: SubjectValues) {
    const { error } = await supabase
      .from('subjects')
      .insert({ level_group: group.key, name: values.name.trim() })
    if (!error) {
      reset()
      load()
    }
  }

  function startEdit(s: Subject) {
    setEditingId(s.id)
    setEditValue(s.name)
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) return
    setBusyId(id)
    const { error } = await supabase.from('subjects').update({ name: editValue.trim() }).eq('id', id)
    if (!error) {
      setEditingId(null)
      await load()
    }
    setBusyId(null)
  }

  async function deleteSubject(id: string) {
    if (!confirm('Delete this subject?')) return
    setBusyId(id)
    const { error } = await supabase.from('subjects').delete().eq('id', id)
    if (!error) setSubjects((prev) => prev.filter((s) => s.id !== id))
    setBusyId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{group.label} subjects</h2>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : subjects.length === 0 ? (
            <p className="text-sm text-gray-400">No subjects added yet.</p>
          ) : (
            subjects.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-royal-50/60 px-3 py-2">
                {editingId === s.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(s.id)}
                    className="flex-1 rounded-md border border-royal-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-royal-100"
                  />
                ) : (
                  <p className="text-sm font-medium text-royal-900">{s.name}</p>
                )}
                <div className="flex items-center gap-2">
                  {editingId === s.id ? (
                    <button
                      onClick={() => saveEdit(s.id)}
                      disabled={busyId === s.id}
                      className="rounded-md p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => startEdit(s)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-royal-50 hover:text-royal-600"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteSubject(s.id)}
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

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex gap-2 border-t border-gray-100 pt-4">
          <div className="flex-1">
            <input
              placeholder="e.g. Mathematics"
              {...register('name')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminSubjects() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [selectedGroup, setSelectedGroup] = useState<GroupDef | null>(null)

  async function loadCounts() {
    const { data } = await supabase.from('subjects').select('level_group')
    const map: Record<string, number> = {}
    for (const row of data ?? []) map[row.level_group] = (map[row.level_group] ?? 0) + 1
    setCounts(map)
  }

  useEffect(() => {
    loadCounts()
  }, [selectedGroup])

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Subjects</h1>
      <p className="mt-1 text-sm text-gray-500">Manage the subjects taught at each level.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {LEVEL_GROUPS.map((group) => (
          <button
            key={group.key}
            onClick={() => setSelectedGroup(group)}
            className={`rounded-xl bg-gradient-to-br ${group.color} p-5 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md`}
          >
            <BookOpen className="h-5 w-5 opacity-90" />
            <p className="mt-3 text-sm font-semibold">{group.label}</p>
            <p className="mt-1 text-2xl font-bold">{counts[group.key] ?? 0}</p>
            <p className="text-xs text-white/80">{(counts[group.key] ?? 0) === 1 ? 'subject' : 'subjects'}</p>
          </button>
        ))}
      </div>

      {selectedGroup && <GroupSubjectsModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />}
    </div>
  )
}