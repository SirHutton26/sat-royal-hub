import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Papa from 'papaparse'
import { Plus, Upload, Download, Trash2, Pencil, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const LEVEL_GROUP_OPTIONS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary (Basic 1–3)' },
  { value: 'upper_primary', label: 'Upper Primary (Basic 4–6)' },
  { value: 'jhs', label: 'JHS (Basic 7–9)' },
]

// Unique colour for each level (full class names so Tailwind picks them up)
const LEVEL_STYLES: Record<string, { label: string; badge: string; dot: string }> = {
  creche: {
    label: 'Creche',
    badge: 'bg-pink-50 text-pink-700 ring-pink-200',
    dot: 'bg-pink-500',
  },
  nursery: {
    label: 'Nursery',
    badge: 'bg-orange-50 text-orange-700 ring-orange-200',
    dot: 'bg-orange-500',
  },
  kg: {
    label: 'KG',
    badge: 'bg-yellow-50 text-yellow-800 ring-yellow-300',
    dot: 'bg-yellow-500',
  },
  lower_primary: {
    label: 'Lower Primary',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  upper_primary: {
    label: 'Upper Primary',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  jhs: {
    label: 'JHS',
    badge: 'bg-purple-50 text-purple-700 ring-purple-200',
    dot: 'bg-purple-500',
  },
}

function LevelBadge({ level }: { level: string | null }) {
  const style = level ? LEVEL_STYLES[level] : undefined
  if (!style) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Not set
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}

interface Teacher {
  id: string
  full_name: string | null
  email: string | null
}

interface SchoolClass {
  id: string
  name: string
  teacher_id: string | null
  level_group: string | null
  teacher: { full_name: string | null; email: string | null } | null
}

const classSchema = z.object({
  name: z.string().trim().min(1, 'Class name is required'),
  levelGroup: z.string().min(1, 'Choose a level'),
  teacherId: z.string(),
})
type ClassValues = z.infer<typeof classSchema>

function ClassFormModal({
  title,
  initial,
  teachers,
  onClose,
  onSave,
}: {
  title: string
  initial?: { name: string; levelGroup: string; teacherId: string }
  teachers: Teacher[]
  onClose: () => void
  onSave: (values: ClassValues) => Promise<string | null>
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClassValues>({
    resolver: zodResolver(classSchema),
    defaultValues: initial ?? { name: '', levelGroup: '', teacherId: '' },
  })

  async function onSubmit(values: ClassValues) {
    setServerError(null)
    const err = await onSave(values)
    if (err) setServerError(err)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/40 px-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{title}</h2>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-royal-900">Class name</label>
            <input
              placeholder="e.g. Basic 4"
              {...register('name')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Level</label>
            <select
              {...register('levelGroup')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              <option value="">Choose a level</option>
              {LEVEL_GROUP_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {errors.levelGroup && <p className="mt-1 text-xs text-red-600">{errors.levelGroup.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Class teacher</label>
            <select
              {...register('teacherId')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name || t.email}
                </option>
              ))}
            </select>
          </div>

          {serverError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminClasses() {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    setLoading(true)
    const [classesRes, teachersRes] = await Promise.all([
      supabase
        .from('classes')
        .select('id, name, teacher_id, level_group, teacher:profiles(full_name, email)')
        .order('name'),
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'teacher')
        .eq('is_active', true)
        .order('full_name'),
    ])
    setClasses((classesRes.data as unknown as SchoolClass[]) ?? [])
    setTeachers(teachersRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  async function createClass(values: ClassValues) {
    const { error } = await supabase
      .from('classes')
      .insert({ name: values.name.trim(), level_group: values.levelGroup, teacher_id: values.teacherId || null })
    if (error) return error.code === '23505' ? 'A class with that name already exists.' : error.message
    setShowAddModal(false)
    loadData()
    return null
  }

  async function updateClass(id: string, values: ClassValues) {
    const { error } = await supabase
      .from('classes')
      .update({ name: values.name.trim(), level_group: values.levelGroup, teacher_id: values.teacherId || null })
      .eq('id', id)
    if (error) return error.code === '23505' ? 'A class with that name already exists.' : error.message
    setEditingClass(null)
    loadData()
    return null
  }

  async function deleteClass(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setBusyId(id)
    const { error } = await supabase.from('classes').delete().eq('id', id)
    if (!error) setClasses((prev) => prev.filter((c) => c.id !== id))
    setBusyId(null)
  }

  async function clearAll() {
    if (classes.length === 0) return
    if (!confirm(`Delete all ${classes.length} classes? This cannot be undone.`)) return
    setUploading(true)
    const ids = classes.map((c) => c.id)
    await supabase.from('classes').delete().in('id', ids)
    await loadData()
    setUploading(false)
  }

  function downloadCSV() {
    const rows = [
      ['Class', 'Class Teacher', 'Teacher Email'],
      ...classes.map((c) => [c.name, c.teacher?.full_name ?? '', c.teacher?.email ?? '']),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'classes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onUploadCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data as Record<string, string>[]
        for (const row of rows) {
          const name = (row['Class'] || row['class'] || '').trim()
          if (!name) continue
          const email = (row['Teacher Email'] || row['teacher email'] || row['Email'] || '').trim().toLowerCase()
          const teacher = email ? teachers.find((t) => t.email?.toLowerCase() === email) : undefined
          await supabase.from('classes').upsert({ name, teacher_id: teacher?.id ?? null }, { onConflict: 'name' })
        }
        await loadData()
        setUploading(false)
      },
      error: () => setUploading(false),
    })
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-royal-900">Class</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload CSV"
            className="flex items-center gap-2 rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 transition hover:bg-royal-100"
          >
            <Upload className="h-4 w-4" />
            Upload CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={onUploadCSV} className="hidden" />
          <button
            onClick={downloadCSV}
            title="Download CSV"
            className="flex items-center gap-2 rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 transition hover:bg-royal-100"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          <button
            onClick={clearAll}
            title="Clear all"
            className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>
      </div>

      {uploading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-royal-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing...
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SN</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Class teacher</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : classes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No classes found.
                </td>
              </tr>
            ) : (
              classes.map((c, i) => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/50">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-royal-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.teacher?.full_name || c.teacher?.email || 'Unassigned'}</td>
                  <td className="px-4 py-3">
                    <LevelBadge level={c.level_group} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingClass(c)}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-royal-50 hover:text-royal-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteClass(c.id, c.name)}
                        disabled={busyId === c.id}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <ClassFormModal title="Add class" teachers={teachers} onClose={() => setShowAddModal(false)} onSave={createClass} />
      )}
      {editingClass && (
        <ClassFormModal
          title="Edit class"
          teachers={teachers}
          initial={{
            name: editingClass.name,
            levelGroup: editingClass.level_group ?? '',
            teacherId: editingClass.teacher_id ?? '',
          }}
          onClose={() => setEditingClass(null)}
          onSave={(values) => updateClass(editingClass.id, values)}
        />
      )}
    </div>
  )
}