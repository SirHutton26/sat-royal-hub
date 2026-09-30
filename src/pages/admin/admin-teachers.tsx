import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Papa from 'papaparse'
import { Plus, Upload, Download, Trash2, Pencil, X, Loader2, UserCheck, UserX } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const LEVEL_GROUP_OPTIONS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary (Basic 1–3)' },
  { value: 'upper_primary', label: 'Upper Primary (Basic 4–6)' },
  { value: 'jhs', label: 'JHS (Basic 7–9)' },
]

// Creche – Basic 6 teachers are automatically class teachers (no subjects).
// JHS teachers are subject teachers; being a class teacher is optional.
const JHS = 'jhs'

// Unique colour for each level (full class names so Tailwind picks them up)
const LEVEL_STYLES: Record<string, { label: string; badge: string; dot: string }> = {
  creche: { label: 'Creche', badge: 'bg-pink-50 text-pink-700 ring-pink-200', dot: 'bg-pink-500' },
  nursery: { label: 'Nursery', badge: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  kg: { label: 'KG', badge: 'bg-yellow-50 text-yellow-800 ring-yellow-300', dot: 'bg-yellow-500' },
  lower_primary: { label: 'Lower Primary', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  upper_primary: { label: 'Upper Primary', badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  jhs: { label: 'JHS', badge: 'bg-purple-50 text-purple-700 ring-purple-200', dot: 'bg-purple-500' },
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}

interface ClassOption {
  id: string
  name: string
  teacher_id: string | null
  level_group: string | null
}

interface SubjectCatalogItem {
  id: string
  name: string
  level_group: string
}

interface TeacherRow {
  id: string
  full_name: string | null
  email: string | null
  is_active: boolean
  level_group: string | null
  classId: string | null
  className: string | null
  subjects: string[]
}

interface SubjectAssignment {
  id: string
  subject: string
  class_id: string
  class: { name: string } | null
}

interface PendingAssignment {
  class_id: string
  className: string
  subject: string
}

const addTeacherSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the teacher's full name"),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(6, 'Temporary password must be at least 6 characters'),
  levelGroup: z.string().min(1, 'Choose a level'),
  classId: z.string(),
})
type AddTeacherValues = z.infer<typeof addTeacherSchema>

const inputClass =
  'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

/** Pick a JHS class, tick one or more subjects, and add them all at once. */
function SubjectPicker({
  teacherId,
  classes,
  subjectsCatalog,
  selected,
  onAdd,
}: {
  teacherId: string
  classes: ClassOption[]
  subjectsCatalog: SubjectCatalogItem[]
  selected: { class_id: string; subject: string }[]
  onAdd: (classId: string, subjects: string[]) => Promise<void>
}) {
  const [classId, setClassId] = useState('')
  const [checked, setChecked] = useState<string[]>([])
  const [takenBy, setTakenBy] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let active = true
    async function loadTaken() {
      setChecked([])
      setTakenBy({})
      if (!classId) return
      const { data } = await supabase
        .from('subject_assignments')
        .select('subject, teacher_id, teacher:profiles(full_name, email)')
        .eq('class_id', classId)
      if (!active) return
      const map: Record<string, string> = {}
      for (const row of (data as unknown as {
        subject: string
        teacher_id: string
        teacher: { full_name: string | null; email: string | null } | null
      }[]) ?? []) {
        if (row.teacher_id === teacherId) continue
        map[row.subject] = row.teacher?.full_name || row.teacher?.email || 'another teacher'
      }
      setTakenBy(map)
    }
    loadTaken()
    return () => {
      active = false
    }
  }, [classId, teacherId])

  const level = classes.find((c) => c.id === classId)?.level_group ?? null
  const available = level ? subjectsCatalog.filter((s) => s.level_group === level) : []
  const alreadyAdded = new Set(selected.filter((s) => s.class_id === classId).map((s) => s.subject))

  function toggle(name: string) {
    setChecked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  async function addSelected() {
    if (!classId || checked.length === 0) return
    setAdding(true)
    await onAdd(classId, checked)
    setChecked([])
    setAdding(false)
  }

  return (
    <div className="mt-3 space-y-2">
      <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass.replace('mt-1 ', '')}>
        <option value="">Choose the class where they teach</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {classId && available.length === 0 && <p className="text-sm text-gray-400">No subjects set for this level.</p>}

      {available.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {available.map((s) => {
            const taken = takenBy[s.name]
            const mine = alreadyAdded.has(s.name)
            const disabled = !!taken || mine
            return (
              <label
                key={s.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  disabled ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-200 text-royal-900 hover:bg-royal-50/50'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={disabled}
                  checked={checked.includes(s.name)}
                  onChange={() => toggle(s.name)}
                />
                <span>
                  {s.name}
                  {taken ? <span className="block text-xs">Taken by {taken}</span> : mine ? <span className="block text-xs">Already added</span> : null}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addSelected}
        disabled={!classId || checked.length === 0 || adding}
        className="rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 hover:bg-royal-100 disabled:opacity-50"
      >
        {adding ? 'Adding...' : `Add selected${checked.length ? ` (${checked.length})` : ''}`}
      </button>
    </div>
  )
}

function AddTeacherModal({
  classes,
  subjectsCatalog,
  onClose,
  onCreated,
}: {
  classes: ClassOption[]
  subjectsCatalog: SubjectCatalogItem[]
  onClose: () => void
  onCreated: () => void
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAssignment[]>([])
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddTeacherValues>({
    resolver: zodResolver(addTeacherSchema),
    defaultValues: { fullName: '', email: '', password: '', levelGroup: '', classId: '' },
  })

  const level = watch('levelGroup')
  const isJhs = level === JHS
  const levelClasses = level ? classes.filter((c) => c.level_group === level) : []
  const jhsClasses = classes.filter((c) => c.level_group === JHS)

  // Changing the level resets everything that depends on it
  useEffect(() => {
    setValue('classId', '')
    setPending([])
    setSubjectError(null)
  }, [level, setValue])

  async function onSubmit(values: AddTeacherValues) {
    setServerError(null)
    setSubjectError(null)

    if (!isJhs && !values.classId) {
      setError('classId', { message: 'Select the class for this teacher' })
      return
    }
    if (isJhs && pending.length === 0) {
      setSubjectError('Add at least one subject for a JHS teacher')
      return
    }

    const { data, error } = await supabase.functions.invoke('create-teacher', {
      body: { fullName: values.fullName, email: values.email, password: values.password },
    })
    if (error) {
      setServerError(error.message || 'Could not create the account. Please try again.')
      return
    }

    const teacherId: string | undefined = data?.id
    const problems: string[] = []

    if (teacherId) {
      const { error: levelError } = await supabase.from('profiles').update({ level_group: values.levelGroup }).eq('id', teacherId)
      if (levelError) problems.push(`level (${levelError.message})`)

      if (values.classId) {
        const { error: classError } = await supabase.from('classes').update({ teacher_id: teacherId }).eq('id', values.classId)
        if (classError) problems.push(`class (${classError.message})`)
      }

      if (isJhs && pending.length > 0) {
        const { error: subjectsError } = await supabase
          .from('subject_assignments')
          .insert(pending.map((p) => ({ teacher_id: teacherId, class_id: p.class_id, subject: p.subject })))
        if (subjectsError) problems.push(`subjects (${subjectsError.message})`)
      }
    } else {
      problems.push('level, class and subjects (no teacher id returned)')
    }

    if (problems.length > 0) {
      alert(`The account was created, but these could not be saved: ${problems.join('; ')}. Please set them by editing the teacher.`)
    }
    onCreated()
  }

  async function addPending(classId: string, subjects: string[]) {
    const className = classes.find((c) => c.id === classId)?.name ?? ''
    setPending((prev) => [
      ...prev,
      ...subjects
        .filter((s) => !prev.some((p) => p.class_id === classId && p.subject === s))
        .map((subject) => ({ class_id: classId, className, subject })),
    ])
    setSubjectError(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">Add teacher</h2>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-royal-900">Full name</label>
            <input {...register('fullName')} className={inputClass} />
            {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-royal-900">Email</label>
            <input type="email" {...register('email')} className={inputClass} />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-royal-900">Temporary password</label>
            <input {...register('password')} className={inputClass} />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Level</label>
            <select {...register('levelGroup')} className={inputClass}>
              <option value="">Choose a level</option>
              {LEVEL_GROUP_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {errors.levelGroup && <p className="mt-1 text-xs text-red-600">{errors.levelGroup.message}</p>}
          </div>

          {level && (
            <div>
              <label className="block text-sm font-medium text-royal-900">
                {isJhs ? 'Class teacher of (optional)' : 'Class teacher of'}
              </label>
              <select {...register('classId')} className={inputClass}>
                <option value="">
                  {isJhs ? 'Not a class teacher' : levelClasses.length === 0 ? 'No classes at this level yet' : 'Choose a class'}
                </option>
                {levelClasses.map((c) => (
                  <option key={c.id} value={c.id} disabled={!!c.teacher_id}>
                    {c.name}
                    {c.teacher_id ? ' — already has a class teacher' : ''}
                  </option>
                ))}
              </select>
              {!isJhs && (
                <p className="mt-1 text-xs text-gray-500">Teachers at this level are class teachers and don't need subjects.</p>
              )}
              {errors.classId && <p className="mt-1 text-xs text-red-600">{errors.classId.message}</p>}
            </div>
          )}

          {isJhs && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-medium text-royal-900">Subjects taught (required)</p>
              <div className="mt-2 space-y-2">
                {pending.length === 0 ? (
                  <p className="text-sm text-gray-400">None added yet.</p>
                ) : (
                  pending.map((p) => (
                    <div key={`${p.class_id}-${p.subject}`} className="flex items-center justify-between rounded-lg bg-royal-50/60 px-3 py-2">
                      <p className="text-sm text-royal-900">
                        {p.subject} <span className="text-gray-400">· {p.className}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setPending((prev) => prev.filter((x) => !(x.class_id === p.class_id && x.subject === p.subject)))}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <SubjectPicker
                teacherId=""
                classes={jhsClasses}
                subjectsCatalog={subjectsCatalog}
                selected={pending}
                onAdd={addPending}
              />
              {subjectError && <p className="mt-2 text-xs text-red-600">{subjectError}</p>}
            </div>
          )}

          {serverError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Creating...' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

function EditTeacherModal({
  teacher,
  classes,
  subjectsCatalog,
  onClose,
  onSaved,
}: {
  teacher: TeacherRow
  classes: ClassOption[]
  subjectsCatalog: SubjectCatalogItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const [level, setLevel] = useState(teacher.level_group ?? '')
  const [classId, setClassId] = useState(teacher.classId ?? '')
  const [isActive, setIsActive] = useState(teacher.is_active)
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAssignmentId, setBusyAssignmentId] = useState<string | null>(null)

  const isJhs = level === JHS
  const levelClasses = level ? classes.filter((c) => c.level_group === level) : []
  const jhsClasses = classes.filter((c) => c.level_group === JHS)

  async function loadAssignments() {
    setLoadingAssignments(true)
    const { data } = await supabase
      .from('subject_assignments')
      .select('id, subject, class_id, class:classes(name)')
      .eq('teacher_id', teacher.id)
    setAssignments((data as unknown as SubjectAssignment[]) ?? [])
    setLoadingAssignments(false)
  }

  useEffect(() => {
    loadAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onLevelChange(value: string) {
    setLevel(value)
    // keep the class only if it belongs to the newly chosen level
    const current = classes.find((c) => c.id === classId)
    if (!current || current.level_group !== value) setClassId('')
  }

  async function addAssignments(newClassId: string, subjects: string[]) {
    setError(null)
    const { error: insertError } = await supabase
      .from('subject_assignments')
      .insert(subjects.map((subject) => ({ teacher_id: teacher.id, class_id: newClassId, subject })))
    if (insertError) {
      setError(insertError.message)
      return
    }
    await loadAssignments()
  }

  async function removeAssignment(id: string) {
    setBusyAssignmentId(id)
    const { error: deleteError } = await supabase.from('subject_assignments').delete().eq('id', id)
    if (!deleteError) setAssignments((prev) => prev.filter((a) => a.id !== id))
    setBusyAssignmentId(null)
  }

  async function save() {
    setError(null)

    if (!level) {
      setError('Choose a level for this teacher.')
      return
    }
    if (!isJhs && !classId) {
      setError('Select the class for this teacher.')
      return
    }
    if (isJhs && assignments.length === 0) {
      setError('A JHS teacher must have at least one subject.')
      return
    }

    setSaving(true)

    await supabase.from('classes').update({ teacher_id: null }).eq('teacher_id', teacher.id)
    if (classId) {
      const { error: classError } = await supabase.from('classes').update({ teacher_id: teacher.id }).eq('id', classId)
      if (classError) {
        setError(classError.message)
        setSaving(false)
        return
      }
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ is_active: isActive, level_group: level })
      .eq('id', teacher.id)
    if (profileError) {
      setError(profileError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{teacher.full_name || teacher.email}</h2>
        <p className="text-xs text-gray-500">{teacher.email}</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-royal-900">Level</label>
            <select value={level} onChange={(e) => onLevelChange(e.target.value)} className={inputClass}>
              <option value="">Choose a level</option>
              {LEVEL_GROUP_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          {level && (
            <div>
              <label className="block text-sm font-medium text-royal-900">
                {isJhs ? 'Class teacher of (optional)' : 'Class teacher of'}
              </label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
                <option value="">{isJhs ? 'Not a class teacher' : 'Choose a class'}</option>
                {levelClasses.map((c) => {
                  const taken = !!c.teacher_id && c.teacher_id !== teacher.id
                  return (
                    <option key={c.id} value={c.id} disabled={taken}>
                      {c.name}
                      {taken ? ' — already has a class teacher' : ''}
                    </option>
                  )
                })}
              </select>
              {!isJhs && (
                <p className="mt-1 text-xs text-gray-500">Teachers at this level are class teachers and don't need subjects.</p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-royal-900">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>

        {isJhs && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-royal-900">Subjects taught (required)</p>
            <div className="mt-2 space-y-2">
              {loadingAssignments ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : assignments.length === 0 ? (
                <p className="text-sm text-gray-400">None assigned.</p>
              ) : (
                assignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-royal-50/60 px-3 py-2">
                    <p className="text-sm text-royal-900">
                      {a.subject} <span className="text-gray-400">· {a.class?.name}</span>
                    </p>
                    <button
                      onClick={() => removeAssignment(a.id)}
                      disabled={busyAssignmentId === a.id}
                      className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <SubjectPicker
              teacherId={teacher.id}
              classes={jhsClasses}
              subjectsCatalog={subjectsCatalog}
              selected={assignments}
              onAdd={addAssignments}
            />
          </div>
        )}

        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="mt-4 w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

export default function AdminTeachers() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [classOptions, setClassOptions] = useState<ClassOption[]>([])
  const [subjectsCatalog, setSubjectsCatalog] = useState<SubjectCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState<TeacherRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    setLoading(true)
    const [profilesRes, classesRes, assignmentsRes, subjectsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, is_active, level_group')
        .eq('role', 'teacher')
        .order('full_name'),
      supabase.from('classes').select('id, name, teacher_id, level_group').order('name'),
      supabase.from('subject_assignments').select('teacher_id, subject, class:classes(name)'),
      supabase.from('subjects').select('id, name, level_group').order('name'),
    ])

    const classIdByTeacher = new Map<string, string>()
    const classNameByTeacher = new Map<string, string>()
    const classLevelByTeacher = new Map<string, string | null>()
    for (const c of classesRes.data ?? []) {
      if (c.teacher_id) {
        classIdByTeacher.set(c.teacher_id, c.id)
        classNameByTeacher.set(c.teacher_id, c.name)
        classLevelByTeacher.set(c.teacher_id, c.level_group)
      }
    }

    const subjectsByTeacher = new Map<string, string[]>()
    for (const a of (assignmentsRes.data as unknown as { teacher_id: string; subject: string; class: { name: string } | null }[]) ?? []) {
      const list = subjectsByTeacher.get(a.teacher_id) ?? []
      list.push(`${a.subject} (${a.class?.name ?? ''})`)
      subjectsByTeacher.set(a.teacher_id, list)
    }

    const rows: TeacherRow[] = (profilesRes.data ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      is_active: p.is_active,
      // use the saved level, or fall back to the level of the class they teach
      level_group: p.level_group ?? classLevelByTeacher.get(p.id) ?? null,
      classId: classIdByTeacher.get(p.id) ?? null,
      className: classNameByTeacher.get(p.id) ?? null,
      subjects: subjectsByTeacher.get(p.id) ?? [],
    }))

    setTeachers(rows)
    setClassOptions(
      (classesRes.data ?? []).map((c) => ({ id: c.id, name: c.name, teacher_id: c.teacher_id, level_group: c.level_group })),
    )
    setSubjectsCatalog(subjectsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  async function deleteTeacher(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This permanently removes their account.`)) return
    setBusyId(id)
    const { error } = await supabase.functions.invoke('delete-teacher', { body: { teacherId: id } })
    if (!error) setTeachers((prev) => prev.filter((t) => t.id !== id))
    setBusyId(null)
  }

  async function clearAll() {
    if (teachers.length === 0) return
    if (!confirm(`Delete all ${teachers.length} teachers? This cannot be undone.`)) return
    setUploading(true)
    for (const t of teachers) {
      await supabase.functions.invoke('delete-teacher', { body: { teacherId: t.id } })
    }
    await loadData()
    setUploading(false)
  }

  function downloadCSV() {
    const rows = [
      ['Name', 'Email', 'Level', 'Class', 'Subjects', 'Status'],
      ...teachers.map((t) => [
        t.full_name ?? '',
        t.email ?? '',
        t.level_group ? LEVEL_STYLES[t.level_group]?.label ?? t.level_group : '',
        t.className ?? '',
        t.subjects.join('; '),
        t.is_active ? 'Active' : 'Inactive',
      ]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'teachers.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseLevel(raw: string): string | null {
    const v = raw.trim().toLowerCase()
    if (!v) return null
    for (const opt of LEVEL_GROUP_OPTIONS) {
      if (v === opt.value || v === opt.label.toLowerCase() || v === LEVEL_STYLES[opt.value].label.toLowerCase()) return opt.value
    }
    return null
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
          const fullName = (row['Full Name'] || row['full name'] || row['Name'] || '').trim()
          const email = (row['Email'] || row['email'] || '').trim()
          const password = (row['Password'] || row['password'] || '').trim()
          if (!fullName || !email || !password) continue
          const { data, error } = await supabase.functions.invoke('create-teacher', { body: { fullName, email, password } })
          const level = parseLevel(row['Level'] || row['level'] || '')
          if (!error && data?.id && level) {
            await supabase.from('profiles').update({ level_group: level }).eq('id', data.id)
          }
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
        <h1 className="text-xl font-semibold text-royal-900">Teachers</h1>
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
              <th className="px-4 py-3">Class teacher</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Subjects</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">Loading...</td>
              </tr>
            ) : teachers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">No teachers found.</td>
              </tr>
            ) : (
              teachers.map((t, i) => (
                <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/50">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-royal-900">{t.full_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{t.email}</td>
                  <td className="px-4 py-3">
                    <LevelBadge level={t.level_group} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.className || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{t.subjects.length > 0 ? t.subjects.join(', ') : '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge active={t.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingTeacher(t)}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-royal-50 hover:text-royal-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteTeacher(t.id, t.full_name || t.email || '')}
                        disabled={busyId === t.id}
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
        <AddTeacherModal
          classes={classOptions}
          subjectsCatalog={subjectsCatalog}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false)
            loadData()
          }}
        />
      )}

      {editingTeacher && (
        <EditTeacherModal
          teacher={editingTeacher}
          classes={classOptions}
          subjectsCatalog={subjectsCatalog}
          onClose={() => setEditingTeacher(null)}
          onSaved={() => {
            setEditingTeacher(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}