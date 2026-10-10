import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { localISO } from '@/lib/attendance'
import { ROLE_LABEL, STAFF_ROLES, fetchAll, type Staff } from '@/lib/headteacher'
import { addDays, monday } from '@/lib/store'

interface Rec {
  teacher_id: string
  date: string
  clock_in_at: string | null
  status: string | null
}

type Preset = 'week' | 'lastweek' | 'month' | 'term' | 'custom'
const PRESETS: { v: Preset; label: string }[] = [
  { v: 'week', label: 'This week' },
  { v: 'lastweek', label: 'Last week' },
  { v: 'month', label: 'This month' },
  { v: 'term', label: 'This term' },
  { v: 'custom', label: 'Custom' },
]

const minutesOf = (iso: string | null) => {
  if (!iso) return null
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  return (Number(p.find((x) => x.type === 'hour')?.value) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value)
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export default function HeadteacherStaffReport() {
  const today = localISO()
  const [preset, setPreset] = useState<Preset>('week')
  const [termStart, setTermStart] = useState(() => localStorage.getItem('sat-term-start') ?? '')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [staff, setStaff] = useState<Staff[]>([])
  const [recs, setRecs] = useState<Rec[] | null>(null)

  const range = useMemo(() => {
    const now = new Date()
    if (preset === 'week') return { from: localISO(monday(now)), to: today }
    if (preset === 'lastweek') {
      const m = addDays(monday(now), -7)
      return { from: localISO(m), to: localISO(addDays(m, 4)) }
    }
    if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
    if (preset === 'term') return { from: termStart || today, to: today }
    return { from, to }
  }, [preset, termStart, from, to, today])

  useEffect(() => {
    let alive = true
    setRecs(null)
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, role').in('role', STAFF_ROLES).eq('is_active', true).order('full_name'),
      fetchAll<Rec>((a, b) => supabase.from('staff_attendance').select('teacher_id, date, clock_in_at, status').gte('date', range.from).lte('date', range.to).order('date').range(a, b)),
    ]).then(([p, r]) => {
      if (!alive) return
      setStaff((p.data ?? []) as Staff[])
      setRecs(r)
    })
    return () => {
      alive = false
    }
  }, [range.from, range.to])

  const report = useMemo(() => {
    if (!recs) return null
    // a day counts as a school day when at least one person clocked in
    const openDays = new Set(recs.map((r) => r.date))
    const rows = staff.map((s) => {
      const mine = recs.filter((r) => r.teacher_id === s.id)
      const late = mine.filter((r) => r.status === 'Late').length
      const veryLate = mine.filter((r) => r.status === 'Very Late').length
      const present = mine.length - late - veryLate
      const mins = mine.map((r) => minutesOf(r.clock_in_at)).filter((m): m is number => m !== null)
      const attended = mine.length
      return {
        s,
        present,
        late,
        veryLate,
        absent: Math.max(0, openDays.size - attended),
        pct: openDays.size ? Math.round((attended / openDays.size) * 100) : 0,
        avg: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
      }
    })
    return { days: openDays.size, rows: rows.sort((a, b) => b.pct - a.pct || (a.s.full_name ?? '').localeCompare(b.s.full_name ?? '')) }
  }, [recs, staff])

  function downloadCsv() {
    if (!report) return
    const head = ['Name', 'Role', 'School days', 'On time', 'Late', 'Very late', 'Absent', 'Attendance %', 'Average check-in']
    const body = report.rows.map((r) => [r.s.full_name ?? r.s.email ?? '', ROLE_LABEL[r.s.role] ?? r.s.role, report.days, r.present, r.late, r.veryLate, r.absent, r.pct, r.avg === null ? '' : hhmm(r.avg)])
    const csv = [head, ...body].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    a.download = `staff-attendance-${range.from}-to-${range.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const avgPct = report && report.rows.length ? Math.round(report.rows.reduce((a, r) => a + r.pct, 0) / report.rows.length) : 0

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Staff attendance report</h1>
      <p className="mt-1 text-sm text-gray-500">How often each staff member came in, and how punctual they were.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.v} onClick={() => setPreset(p.v)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${preset === p.v ? 'bg-royal-700 text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'term' && (
        <label className="mt-3 block text-sm text-gray-600">
          Term started on
          <input type="date" value={termStart} max={today} onChange={(e) => { setTermStart(e.target.value); localStorage.setItem('sat-term-start', e.target.value) }} className="ml-2 rounded-lg border border-gray-300 px-3 py-1.5" />
        </label>
      )}
      {preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          From <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5" />
          to <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5" />
        </div>
      )}

      {!report ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[['School days', report.days], ['Staff', report.rows.length], ['Average attendance', `${avgPct}%`]].map(([k, v]) => (
              <div key={String(k)} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className="mt-1 text-2xl font-bold text-royal-900">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">{range.from} to {range.to}. A school day is any day someone clocked in; holidays are skipped automatically.</p>

          <div className="mt-3 flex justify-end">
            <button onClick={downloadCsv} disabled={!report.rows.length} className="flex items-center gap-1.5 rounded-lg border border-royal-200 bg-white px-3 py-1.5 text-sm font-semibold text-royal-700 hover:bg-royal-50 disabled:opacity-50">
              <Download className="h-4 w-4" /> Download CSV
            </button>
          </div>

          <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-2 py-3 text-right font-semibold">On time</th>
                  <th className="px-2 py-3 text-right font-semibold">Late</th>
                  <th className="px-2 py-3 text-right font-semibold">Very late</th>
                  <th className="px-2 py-3 text-right font-semibold">Absent</th>
                  <th className="px-2 py-3 text-right font-semibold">Avg. in</th>
                  <th className="px-4 py-3 text-right font-semibold">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.s.id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-medium text-royal-900">
                      {r.s.full_name || r.s.email}
                      {r.s.role !== 'teacher' && <span className="ml-2 text-xs font-normal text-gray-400">{ROLE_LABEL[r.s.role] ?? r.s.role}</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold text-green-600">{r.present}</td>
                    <td className="px-2 py-2.5 text-right font-semibold text-orange-500">{r.late}</td>
                    <td className="px-2 py-2.5 text-right font-semibold text-red-600">{r.veryLate}</td>
                    <td className="px-2 py-2.5 text-right font-semibold text-gray-800">{r.absent}</td>
                    <td className="px-2 py-2.5 text-right text-gray-600">{r.avg === null ? '-' : hhmm(r.avg)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${r.pct >= 90 ? 'bg-green-50 text-green-700' : r.pct >= 75 ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>{r.pct}%</span>
                    </td>
                  </tr>
                ))}
                {report.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No staff found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
