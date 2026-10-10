import { useEffect, useMemo, useState } from 'react'
import { Loader2, Phone, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchAll, isFemale, isMale } from '@/lib/headteacher'

interface S {
  id: string
  full_name: string
  admission_number: string
  gender: string | null
  class_id: string
  guardian_name: string | null
  guardian_phone: string | null
}
interface C {
  id: string
  name: string
}

export default function HeadteacherStudents() {
  const [students, setStudents] = useState<S[] | null>(null)
  const [classes, setClasses] = useState<C[]>([])
  const [classId, setClassId] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('id, name').order('name'),
      fetchAll<S>((a, b) => supabase.from('students').select('id, full_name, admission_number, gender, class_id, guardian_name, guardian_phone').eq('is_active', true).order('full_name').range(a, b)),
    ]).then(([c, s]) => {
      setClasses((c.data ?? []) as C[])
      setStudents(s)
    })
  }, [])

  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (students ?? [])
      .filter((x) => classId === 'all' || x.class_id === classId)
      .filter((x) => !s || x.full_name.toLowerCase().includes(s) || x.admission_number.toLowerCase().includes(s) || (x.guardian_name ?? '').toLowerCase().includes(s))
  }, [students, classId, q])

  const count = (id: string) => (students ?? []).filter((x) => x.class_id === id)
  const boys = (students ?? []).filter((x) => isMale(x.gender)).length
  const girls = (students ?? []).filter((x) => isFemale(x.gender)).length

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Students</h1>
      <p className="mt-1 text-sm text-gray-500">Enrolment by class and contact details of guardians.</p>

      {!students ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[['On roll', students.length], ['Boys', boys], ['Girls', girls]].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className="mt-1 text-2xl font-bold text-royal-900">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setClassId('all')} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${classId === 'all' ? 'bg-royal-700 text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
              All ({students.length})
            </button>
            {classes.map((c) => (
              <button key={c.id} onClick={() => setClassId(c.id)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${classId === c.id ? 'bg-royal-700 text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
                {c.name} ({count(c.id).length})
              </button>
            ))}
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, admission number or guardian" className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm" />
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold">Gender</th>
                  <th className="px-4 py-3 font-semibold">Guardian</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s, i) => (
                  <tr key={s.id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-royal-900">{s.full_name}</p>
                      <p className="text-xs text-gray-400">{s.admission_number}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{className.get(s.class_id) ?? ''}</td>
                    <td className="px-4 py-2.5 text-gray-600">{isMale(s.gender) ? 'Male' : isFemale(s.gender) ? 'Female' : '-'}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-gray-700">{s.guardian_name || '-'}</p>
                      {s.guardian_phone && (
                        <a href={`tel:${s.guardian_phone}`} className="inline-flex items-center gap-1 text-xs font-medium text-royal-600 hover:underline">
                          <Phone className="h-3 w-3" /> {s.guardian_phone}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No students found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
