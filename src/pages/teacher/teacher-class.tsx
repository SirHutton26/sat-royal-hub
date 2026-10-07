import { useEffect, useRef, useState } from 'react'
import { Search, X, Phone, Pencil, Camera, Loader2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

// Change this if your photos live in a different Supabase Storage bucket
import StudentPhotoImg from '@/components/student-photo'
import { forgetPhoto } from '@/lib/photo'
const PHOTO_BUCKET = 'student-photos'
const MAX_PHOTO_MB = 8

const STUDENT_COLUMNS =
  'id, full_name, admission_number, gender, date_of_birth, guardian_name, guardian_phone, photo_url, is_active'

interface Student {
  id: string
  full_name: string
  admission_number: string
  gender: string | null
  date_of_birth: string | null
  guardian_name: string | null
  guardian_phone: string | null
  photo_url: string | null
  is_active: boolean
}

type ToastState = { type: 'success' | 'error'; message: string } | null

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 2800)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  return (
    <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div
        className={`flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        } text-white`}
      >
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        <p className="text-sm font-medium">{toast.message}</p>
      </div>
    </div>
  )
}

function StudentAvatar({ url, name, size }: { url: string | null; name: string; size: string }) {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  const circle = (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-royal-600 text-2xl font-bold text-white`}>
      {initials}
    </span>
  )
  if (url) return <StudentPhotoImg url={url} className={`${size} shrink-0 rounded-full object-cover`} fallback={circle} />
  return circle
}

function formatDob(dob: string | null): string {
  if (!dob) return '—'
  const [y, m, d] = dob.split('-').map(Number)
  if (!y || !m || !d) return dob
  const date = new Date(y, m - 1, d)
  const text = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) age--
  return age >= 0 ? `${text} (${age} yrs)` : text
}

function todayIso(): string {
  const n = new Date()
  const mm = String(n.getMonth() + 1).padStart(2, '0')
  const dd = String(n.getDate()).padStart(2, '0')
  return `${n.getFullYear()}-${mm}-${dd}`
}

// Center-crops to a square and shrinks to 512px so uploads stay small on slow connections
function resizeToSquareJpeg(file: File, size = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const target = Math.min(size, side)
      const canvas = document.createElement('canvas')
      canvas.width = target
      canvas.height = target
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not process the image.'))
        return
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the image.'))),
        'image/jpeg',
        0.85
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a readable image.'))
    }
    img.src = url
  })
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-royal-900">{children}</dd>
    </div>
  )
}

function StudentModal({
  student,
  className,
  onClose,
  onSaved,
  onToast,
}: {
  student: Student
  className: string | null
  onClose: () => void
  onSaved: (updated: Student) => void
  onToast: (t: ToastState) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dob, setDob] = useState(student.date_of_birth ?? '')
  const [guardianName, setGuardianName] = useState(student.guardian_name ?? '')
  const [guardianPhone, setGuardianPhone] = useState(student.guardian_phone ?? '')
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Close on Escape, but never while saving or editing (so edits aren't lost by accident)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !editing && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing, saving])

  // Free the preview URL when it changes or the modal closes
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  function startEdit() {
    setDob(student.date_of_birth ?? '')
    setGuardianName(student.guardian_name ?? '')
    setGuardianPhone(student.guardian_phone ?? '')
    setPhotoBlob(null)
    setPhotoPreview(null)
    setRemovePhoto(false)
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    if (saving) return
    setEditing(false)
    setError(null)
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      setError(`Image is too large. Maximum is ${MAX_PHOTO_MB} MB.`)
      return
    }
    try {
      const blob = await resizeToSquareJpeg(file)
      setPhotoBlob(blob)
      setPhotoPreview(URL.createObjectURL(blob))
      setRemovePhoto(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.')
    }
  }

  function clearPhoto() {
    setPhotoBlob(null)
    setPhotoPreview(null)
    setRemovePhoto(true)
  }

  async function handleSave() {
    setError(null)

    if (dob && dob > todayIso()) {
      setError('Date of birth cannot be in the future.')
      return
    }

    const phone = guardianPhone.replace(/[\s-]/g, '')
    if (phone && !/^\+?\d{9,15}$/.test(phone)) {
      setError('Enter a valid phone number, e.g. 0244123456 or +233244123456.')
      return
    }

    setSaving(true)

    let photoUrl: string | null = student.photo_url
    const path = `${student.id}/avatar.jpg`

    if (photoBlob) {
      const { error: upErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, photoBlob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) {
        setSaving(false)
        setError(`Could not upload the photo: ${upErr.message}`)
        return
      }
      // store the private path; screens load it through a short-lived link
      forgetPhoto(path)
      photoUrl = path
    } else if (removePhoto) {
      photoUrl = null
      forgetPhoto(path)
      await supabase.storage.from(PHOTO_BUCKET).remove([path]) // best effort
    }

    const { data, error: updErr } = await supabase
      .from('students')
      .update({
        date_of_birth: dob || null,
        guardian_name: guardianName.trim() || null,
        guardian_phone: phone || null,
        photo_url: photoUrl,
      })
      .eq('id', student.id)
      .select(STUDENT_COLUMNS)

    setSaving(false)

    if (updErr || !data || data.length === 0) {
      setError(updErr?.message ?? 'Could not save. You may not have permission to edit this student.')
      return
    }

    onSaved(data[0] as Student)
    setEditing(false)
    onToast({ type: 'success', message: 'Student details updated.' })
  }

  const shownPhoto = photoPreview ?? (removePhoto ? null : student.photo_url)
  const hasPhoto = !!shownPhoto

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8 backdrop-blur-sm"
      onClick={() => {
        if (!editing && !saving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${student.full_name} details`}
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={saving}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <StudentAvatar url={shownPhoto} name={student.full_name} size="h-24 w-24" />
            {editing && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={saving}
                aria-label="Change photo"
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-royal-600 text-white shadow-md transition hover:bg-royal-700 disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
          </div>

          {editing && hasPhoto && (
            <button
              type="button"
              onClick={clearPhoto}
              disabled={saving}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove photo
            </button>
          )}

          <h2 className="mt-3 text-lg font-semibold text-royal-900">{student.full_name}</h2>
          <p className="text-sm text-gray-500">{student.admission_number}</p>
          <span
            className={`mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              student.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {student.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {!editing ? (
          <>
            <dl className="mt-5">
              <DetailRow label="Class">{className || '—'}</DetailRow>
              <DetailRow label="Gender">
                {student.gender ? <span className="capitalize">{student.gender}</span> : '—'}
              </DetailRow>
              <DetailRow label="Date of birth">{formatDob(student.date_of_birth)}</DetailRow>
              <DetailRow label="Guardian">{student.guardian_name || '—'}</DetailRow>
              <DetailRow label="Guardian phone">
                {student.guardian_phone ? (
                  <a href={`tel:${student.guardian_phone}`} className="inline-flex items-center gap-1 text-royal-600 hover:underline">
                    <Phone className="h-3.5 w-3.5" />
                    {student.guardian_phone}
                  </a>
                ) : (
                  '—'
                )}
              </DetailRow>
            </dl>

            <button
              onClick={startEdit}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 py-2 text-sm font-semibold text-royal-700 transition hover:bg-gray-50"
            >
              <Pencil className="h-4 w-4" />
              Edit details
            </button>
          </>
        ) : (
          <div className="mt-5 space-y-3">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">Date of birth</label>
              <input
                type="date"
                value={dob}
                max={todayIso()}
                onChange={(e) => setDob(e.target.value)}
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">Guardian</label>
              <input
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Guardian's full name"
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">Guardian phone</label>
              <input
                type="tel"
                inputMode="tel"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
                placeholder="e.g. 0244123456"
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100 disabled:bg-gray-50"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeacherClass() {
  const { profile } = useAuth()
  const [className, setClassName] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Student | null>(null)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    let active = true

    async function load() {
      if (!profile) return
      const { data: myClass } = await supabase
        .from('classes')
        .select('id, name')
        .eq('teacher_id', profile.id)
        .maybeSingle()

      if (!active) return

      if (myClass) {
        setClassName(myClass.name)
        const { data } = await supabase
          .from('students')
          .select(STUDENT_COLUMNS)
          .eq('class_id', myClass.id)
          .eq('is_active', true)
          .order('full_name')
        if (active) setStudents(data ?? [])
      }
      setLoading(false)
    }

    load()
    return () => {
      active = false
    }
  }, [profile])

  function handleSaved(updated: Student) {
    setStudents((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    setSelected(updated)
  }

  const filtered = students.filter((s) => {
    const q = search.trim().toLowerCase()
    return !q || s.full_name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q)
  })

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">My Class {className && `· ${className}`}</h1>

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
              <th className="w-16 px-4 py-3">SN</th>
              <th className="px-4 py-3">Name</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-400">
                  {className ? 'No students found.' : 'You have no assigned class.'}
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/50">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelected(s)}
                      className="font-medium text-royal-900 underline-offset-2 hover:text-royal-600 hover:underline"
                    >
                      {s.full_name}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <StudentModal
          key={selected.id}
          student={selected}
          className={className}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
          onToast={setToast}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}