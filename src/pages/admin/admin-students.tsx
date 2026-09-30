import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Papa from 'papaparse'
import {
  Plus,
  Upload,
  Download,
  Search,
  X,
  Trash2,
  Pencil,
  Loader2,
  Camera,
  Users,
  Mars,
  Venus,
  UserCheck,
  UserX,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface SchoolClass {
  id: string
  name: string
}

interface Student {
  id: string
  full_name: string
  admission_number: string
  class_id: string | null
  class: { name: string } | null
  gender: string | null
  date_of_birth: string | null
  guardian_name: string | null
  guardian_phone: string | null
  photo_url: string | null
  is_active: boolean
}

type StudentInsert = Record<string, unknown>

const PHOTO_BUCKET = 'student-photos'
const MAX_PHOTO_MB = 2

const studentSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the student's full name"),
  classId: z.string().min(1, 'Select a class'),
  gender: z.enum(['male', 'female', '']),
  dateOfBirth: z.string(),
  guardianName: z.string().trim(),
  guardianPhone: z.string().trim(),
})
type StudentValues = z.infer<typeof studentSchema>

const inputClass =
  'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/* ------------------------------------------------------------------ */
/* Admission numbers: SAT-<year>-001, SAT-<year>-002, ...              */
/* ------------------------------------------------------------------ */
async function nextAdmissionNumbers(count: number): Promise<string[]> {
  const prefix = `SAT-${new Date().getFullYear()}-`
  const { data } = await supabase.from('students').select('admission_number').like('admission_number', `${prefix}%`)
  let max = 0
  for (const row of data ?? []) {
    const n = parseInt(String(row.admission_number).slice(prefix.length), 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + i + 1).padStart(3, '0')}`)
}

/** Inserts students with freshly generated admission numbers (retries if two admins collide). */
async function insertStudents(rows: StudentInsert[]): Promise<string | null> {
  if (rows.length === 0) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    const numbers = await nextAdmissionNumbers(rows.length)
    const { error } = await supabase
      .from('students')
      .insert(rows.map((r, i) => ({ ...r, admission_number: numbers[i] })))
    if (!error) return null
    if (error.code !== '23505') return error.message
  }
  return 'Could not generate a unique admission number. Please try again.'
}

function StudentAvatar({ url, name, size = 'h-10 w-10' }: { url: string | null; name: string; size?: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-royal-600 text-xs font-bold text-white`}>
      {initials}
    </span>
  )
}

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

function GenderBadge({ gender }: { gender: string | null }) {
  if (gender === 'male')
    return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Male</span>
  if (gender === 'female')
    return <span className="rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700">Female</span>
  return <span className="text-gray-400">—</span>
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: number
  hint: string
  icon: React.ReactNode
  tone: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm">
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div>
        <p className="text-2xl font-semibold text-royal-900">{value}</p>
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-xs text-gray-400">{hint}</p>
      </div>
    </div>
  )
}

function StudentFormModal({
  student,
  classes,
  defaultClassId,
  onClose,
  onSaved,
}: {
  student?: Student
  classes: SchoolClass[]
  defaultClassId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!student
  const [serverError, setServerError] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(student?.photo_url ?? null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StudentValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      fullName: student?.full_name ?? '',
      classId: student?.class_id ?? defaultClassId,
      gender: (student?.gender as 'male' | 'female' | null) ?? '',
      dateOfBirth: student?.date_of_birth ?? '',
      guardianName: student?.guardian_name ?? '',
      guardianPhone: student?.guardian_phone ?? '',
    },
  })

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.')
      return
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      setPhotoError(`Image must be smaller than ${MAX_PHOTO_MB}MB.`)
      return
    }
    setPhotoError(null)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function uploadPhoto(studentId: string, file: File): Promise<{ url?: string; error?: string }> {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${studentId}/photo.${ext}`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: true })
    if (error) return { error: error.message }
    const url = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
    return { url: `${url}?v=${Date.now()}` }
  }

  async function onSubmit(values: StudentValues) {
    setServerError(null)
    const fields = {
      full_name: values.fullName.trim(),
      class_id: values.classId,
      gender: values.gender || null,
      date_of_birth: values.dateOfBirth || null,
      guardian_name: values.guardianName.trim() || null,
      guardian_phone: values.guardianPhone.trim() || null,
    }

    if (isEdit && student) {
      let photoUrl = student.photo_url
      if (photoFile) {
        const res = await uploadPhoto(student.id, photoFile)
        if (res.error) {
          setServerError(res.error)
          return
        }
        photoUrl = res.url ?? photoUrl
      }
      const { error } = await supabase
        .from('students')
        .update({ ...fields, photo_url: photoUrl })
        .eq('id', student.id)
      if (error) {
        setServerError(error.message)
        return
      }
      onSaved()
      return
    }

    // New student: the admission number is generated automatically
    const id = crypto.randomUUID()
    let photoUrl: string | null = null
    if (photoFile) {
      const res = await uploadPhoto(id, photoFile)
      if (res.error) {
        setServerError(res.error)
        return
      }
      photoUrl = res.url ?? null
    }
    const err = await insertStudents([{ id, ...fields, photo_url: photoUrl }])
    if (err) {
      setServerError(err)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{isEdit ? 'Edit student' : 'Add student'}</h2>
        {isEdit ? (
          <p className="text-xs text-gray-500">Admission number: {student?.admission_number}</p>
        ) : (
          <p className="text-xs text-gray-500">The admission number is generated automatically.</p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-3">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative"
              aria-label="Choose profile picture"
            >
              <StudentAvatar url={photoPreview} name={student?.full_name ?? ''} size="h-20 w-20" />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-royal-600 text-white shadow group-hover:bg-royal-700">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
            <p className="text-xs text-gray-500">Profile picture (optional, max {MAX_PHOTO_MB}MB)</p>
            {photoError && <p className="text-xs text-red-600">{photoError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Full name</label>
            <input {...register('fullName')} className={inputClass} />
            {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-royal-900">Class</label>
              <select {...register('classId')} className={inputClass}>
                <option value="">Select</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.classId && <p className="mt-1 text-xs text-red-600">{errors.classId.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-royal-900">Gender</label>
              <select {...register('gender')} className={inputClass}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Date of birth</label>
            <input type="date" {...register('dateOfBirth')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Guardian name</label>
            <input {...register('guardianName')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Guardian phone</label>
            <input {...register('guardianPhone')} className={inputClass} />
          </div>

          {serverError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Saving...' : isEdit ? 'Save changes' : 'Add student'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    setLoading(true)
    const [studentsRes, classesRes] = await Promise.all([
      supabase
        .from('students')
        .select(
          'id, full_name, admission_number, class_id, gender, date_of_birth, guardian_name, guardian_phone, photo_url, is_active, class:classes(name)',
        )
        .order('admission_number'),
      supabase.from('classes').select('id, name').order('name'),
    ])
    setStudents((studentsRes.data as unknown as Student[]) ?? [])
    setClasses(classesRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const selectedClass = classes.find((c) => c.id === classFilter) ?? null

  // Cards: whole school until a class is chosen, then that class
  const scope = classFilter ? students.filter((s) => s.class_id === classFilter) : students
  const total = scope.length
  const males = scope.filter((s) => s.gender === 'male').length
  const females = scope.filter((s) => s.gender === 'female').length
  const scopeHint = selectedClass ? selectedClass.name : 'All classes'

  const classStudents = students.filter((s) => s.class_id === classFilter)
  const filtered = classStudents.filter((s) => {
    const q = search.trim().toLowerCase()
    return !q || s.full_name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q)
  })

  async function toggleActive(student: Student) {
    setUpdatingId(student.id)
    const { error } = await supabase.from('students').update({ is_active: !student.is_active }).eq('id', student.id)
    if (!error) {
      setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, is_active: !s.is_active } : s)))
    }
    setUpdatingId(null)
  }

  async function deleteStudent(id: string, name: string) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return
    setUpdatingId(id)
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (!error) setStudents((prev) => prev.filter((s) => s.id !== id))
    else setNotice({ type: 'error', text: error.message })
    setUpdatingId(null)
  }

  async function clearClass() {
    if (!selectedClass || classStudents.length === 0) return
    if (!confirm(`Delete all ${classStudents.length} students in ${selectedClass.name}? This cannot be undone.`)) return
    setBusy(true)
    setNotice(null)
    const { error } = await supabase.from('students').delete().eq('class_id', selectedClass.id)
    if (error) setNotice({ type: 'error', text: error.message })
    else setNotice({ type: 'success', text: `All students in ${selectedClass.name} were removed.` })
    await loadData()
    setBusy(false)
  }

  function downloadCSV() {
    if (!selectedClass) return
    const rows = [
      ['Admission Number', 'Full Name', 'Gender', 'Date of Birth', 'Guardian Name', 'Guardian Phone', 'Status'],
      ...classStudents.map((s) => [
        s.admission_number,
        s.full_name,
        s.gender ?? '',
        s.date_of_birth ?? '',
        s.guardian_name ?? '',
        s.guardian_phone ?? '',
        s.is_active ? 'Active' : 'Inactive',
      ]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `students-${selectedClass.name.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseGender(raw: string): string | null {
    const v = raw.trim().toLowerCase()
    if (v === 'male' || v === 'm') return 'male'
    if (v === 'female' || v === 'f') return 'female'
    return null
  }

  function onUploadCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedClass) return
    setBusy(true)
    setNotice(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: async (result) => {
        const existingByNumber = new Map(students.map((s) => [s.admission_number.toLowerCase(), s]))
        const toInsert: StudentInsert[] = []
        let updated = 0
        let skipped = 0
        let failure: string | null = null

        for (const row of result.data) {
          const fullName = (row['full name'] || row['name'] || '').trim()
          if (!fullName) {
            skipped++
            continue
          }
          const dob = (row['date of birth'] || row['dob'] || '').trim()
          const fields = {
            full_name: fullName,
            gender: parseGender(row['gender'] || ''),
            date_of_birth: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null,
            guardian_name: (row['guardian name'] || row['guardian'] || '').trim() || null,
            guardian_phone: (row['guardian phone'] || row['phone'] || '').trim() || null,
          }

          // A row that carries an existing admission number updates that student instead of duplicating them
          const number = (row['admission number'] || row['admission #'] || '').trim().toLowerCase()
          const existing = number ? existingByNumber.get(number) : undefined
          if (existing) {
            if (existing.class_id !== selectedClass.id) {
              skipped++
              continue
            }
            const { error } = await supabase.from('students').update(fields).eq('id', existing.id)
            if (error) failure = error.message
            else updated++
            continue
          }

          toInsert.push({ ...fields, class_id: selectedClass.id })
        }

        const insertError = await insertStudents(toInsert)
        if (insertError) failure = insertError

        await loadData()
        setBusy(false)
        if (failure) {
          setNotice({ type: 'error', text: failure })
        } else {
          setNotice({
            type: 'success',
            text: `${selectedClass.name}: ${toInsert.length} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}.`,
          })
        }
      },
      error: () => {
        setBusy(false)
        setNotice({ type: 'error', text: 'Could not read that CSV file.' })
      },
    })
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Students</h1>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total students"
          value={total}
          hint={scopeHint}
          icon={<Users className="h-6 w-6 text-royal-700" />}
          tone="bg-royal-50"
        />
        <StatCard
          label="Males"
          value={males}
          hint={scopeHint}
          icon={<Mars className="h-6 w-6 text-blue-700" />}
          tone="bg-blue-50"
        />
        <StatCard
          label="Females"
          value={females}
          hint={scopeHint}
          icon={<Venus className="h-6 w-6 text-pink-700" />}
          tone="bg-pink-50"
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <select
          value={classFilter}
          onChange={(e) => {
            setClassFilter(e.target.value)
            setSearch('')
            setNotice(null)
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        >
          <option value="">Select a class</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

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
            disabled={!selectedClass || busy}
            title={selectedClass ? 'Upload CSV' : 'Select a class first'}
            className="flex items-center gap-2 rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 transition hover:bg-royal-100 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Upload CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={onUploadCSV} className="hidden" />
          <button
            onClick={downloadCSV}
            disabled={!selectedClass || classStudents.length === 0}
            title={selectedClass ? 'Download CSV' : 'Select a class first'}
            className="flex items-center gap-2 rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 transition hover:bg-royal-100 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          <button
            onClick={clearClass}
            disabled={!selectedClass || classStudents.length === 0 || busy}
            title={selectedClass ? 'Clear all students in this class' : 'Select a class first'}
            className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>
      </div>

      {busy && (
        <div className="mt-3 flex items-center gap-2 text-sm text-royal-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing...
        </div>
      )}

      {notice && (
        <p
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            notice.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {notice.text}
        </p>
      )}

      {!selectedClass ? (
        <div className="mt-4 rounded-xl bg-white px-4 py-12 text-center text-sm text-gray-400 shadow-sm">
          Select a class to see its students.
        </div>
      ) : (
        <>
          <div className="relative mt-4 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or admission number"
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">SN</th>
                  <th className="px-4 py-3">Admission number</th>
                  <th className="px-4 py-3">Profile</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Guardian</th>
                  <th className="px-4 py-3">Gender</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                      No students found in {selectedClass.name}.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/50">
                      <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-royal-900">{s.admission_number}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StudentAvatar url={s.photo_url} name={s.full_name} />
                          <span className="font-medium text-royal-900">{s.full_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{s.class?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {s.guardian_phone || '—'}
                        {s.guardian_name && <span className="block text-xs text-gray-400">{s.guardian_name}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <GenderBadge gender={s.gender} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge active={s.is_active} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingStudent(s)}
                            aria-label={`Edit ${s.full_name}`}
                            className="rounded-md p-1.5 text-gray-400 transition hover:bg-royal-50 hover:text-royal-600"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleActive(s)}
                            disabled={updatingId === s.id}
                            className={`rounded-md px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                              s.is_active
                                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                : 'bg-green-50 text-green-700 hover:bg-green-100'
                            }`}
                          >
                            {s.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => deleteStudent(s.id, s.full_name)}
                            disabled={updatingId === s.id}
                            aria-label={`Remove ${s.full_name}`}
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
        </>
      )}

      {showAddModal && (
        <StudentFormModal
          classes={classes}
          defaultClassId={classFilter}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false)
            loadData()
          }}
        />
      )}

      {editingStudent && (
        <StudentFormModal
          student={editingStudent}
          classes={classes}
          defaultClassId={classFilter}
          onClose={() => setEditingStudent(null)}
          onSaved={() => {
            setEditingStudent(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}