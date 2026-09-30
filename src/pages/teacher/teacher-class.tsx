import { useEffect, useState } from 'react'
import { Search, X, Phone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

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

function StudentAvatar({ url, name, size }: { url: string | null; name: string; size: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-royal-600 text-2xl font-bold text-white`}>
      {initials}
    </span>
  )
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-royal-900">{children}</dd>
    </div>
  )
}

function StudentModal({ student, className, onClose }: { student: Student; className: string | null; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-royal-900/40 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${student.full_name} details`}
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <StudentAvatar url={student.photo_url} name={student.full_name} size="h-24 w-24" />
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
          .select('id, full_name, admission_number, gender, date_of_birth, guardian_name, guardian_phone, photo_url, is_active')
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

      {selected && <StudentModal student={selected} className={className} onClose={() => setSelected(null)} />}
    </div>
  )
}