import { useEffect, useState } from 'react'
import {
  Check,
  X,
  Clock,
  ClipboardCheck,
  History,
  ChartPie,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Trophy,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */
type Status = 'present' | 'absent' | 'late'
type Tab = 'mark' | 'history' | 'stats'
type Mode = 'week' | 'month' | 'all'

interface Student {
  id: string
  full_name: string
  admission_number: string
  gender: string | null
}

interface AttRow {
  student_id: string
  date: string
  status: Status
}

interface StudentStat {
  student: Student
  present: number // on time
  late: number
  absent: number
  attended: number // present + late (late counts as present)
  days: number
  rate: number
}

interface GenderStat {
  count: number
  rate: number | null
}

interface Report {
  days: string[]
  cells: Map<string, Map<string, Status>>
  stats: StudentStat[]
  totals: { present: number; late: number; absent: number; possible: number }
  rate: number
  daily: { date: string; rate: number }[]
  gender: { male: GenderStat; female: GenderStat }
}

const CUTOFF_HOUR = 12 // attendance is submitted automatically at 12:00 PM

const STATUS_OPTIONS: { value: Status; label: string; icon: typeof Check }[] = [
  { value: 'present', label: 'Present', icon: Check },
  { value: 'absent', label: 'Absent', icon: X },
  { value: 'late', label: 'Late', icon: Clock },
]

const STATUS_STYLES: Record<Status, string> = {
  present: 'bg-green-100 text-green-700 border-green-300',
  absent: 'bg-red-100 text-red-700 border-red-300',
  late: 'bg-amber-100 text-amber-700 border-amber-300',
}

const CHART_COLORS = { present: '#16a34a', late: '#f59e0b', absent: '#ef4444' }

/* ------------------------------------------------------------------ */
/* Date helpers (all local time, so "today" matches the teacher's day)  */
/* ------------------------------------------------------------------ */
const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function parseISO(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday
  return x
}
const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function getRange(mode: Mode, offset: number): { from: string; to: string; label: string } {
  const today = new Date()
  if (mode === 'week') {
    const start = startOfWeek(today)
    start.setDate(start.getDate() + offset * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return { from: toISO(start), to: toISO(end), label: `${fmtShort(start)} – ${fmtShort(end)} ${end.getFullYear()}` }
  }
  if (mode === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    return {
      from: toISO(first),
      to: toISO(last),
      label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    }
  }
  return { from: '2000-01-01', to: toISO(today), label: 'All time' }
}

function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/* ------------------------------------------------------------------ */
/* Data helpers                                                        */
/* ------------------------------------------------------------------ */
async function fetchAttendance(classId: string, from: string, to: string): Promise<AttRow[]> {
  const out: AttRow[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('attendance')
      .select('student_id, date, status')
      .eq('class_id', classId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('student_id')
      .range(page * 1000, page * 1000 + 999)
    if (error || !data) break
    out.push(...(data as AttRow[]))
    if (data.length < 1000) break
  }
  return out
}

/**
 * A "school day" is any date on which attendance was recorded for the class.
 * A student with no record on a school day is counted absent.
 * Late counts as present.
 */
function buildReport(students: Student[], rows: AttRow[]): Report {
  const ids = new Set(students.map((s) => s.id))
  const dayset = new Set<string>()
  const cells = new Map<string, Map<string, Status>>()
  for (const r of rows) {
    dayset.add(r.date)
    if (!ids.has(r.student_id)) continue
    let m = cells.get(r.student_id)
    if (!m) cells.set(r.student_id, (m = new Map()))
    m.set(r.date, r.status)
  }
  const days = [...dayset].sort()

  const stats: StudentStat[] = students.map((student) => {
    let present = 0
    let late = 0
    for (const d of days) {
      const st = cells.get(student.id)?.get(d)
      if (st === 'present') present++
      else if (st === 'late') late++
    }
    const attended = present + late
    return {
      student,
      present,
      late,
      absent: days.length - attended,
      attended,
      days: days.length,
      rate: days.length ? (attended / days.length) * 100 : 0,
    }
  })

  const totals = stats.reduce(
    (t, s) => ({ present: t.present + s.present, late: t.late + s.late, absent: t.absent + s.absent, possible: t.possible + s.days }),
    { present: 0, late: 0, absent: 0, possible: 0 },
  )

  const daily = days.map((date) => {
    let attended = 0
    for (const s of students) {
      const st = cells.get(s.id)?.get(date)
      if (st === 'present' || st === 'late') attended++
    }
    return { date, rate: students.length ? (attended / students.length) * 100 : 0 }
  })

  const genderStat = (g: string): GenderStat => {
    const list = stats.filter((s) => s.student.gender === g)
    const possible = list.reduce((a, s) => a + s.days, 0)
    const attended = list.reduce((a, s) => a + s.attended, 0)
    return { count: list.length, rate: possible ? (attended / possible) * 100 : null }
  }

  return {
    days,
    cells,
    stats,
    totals,
    rate: totals.possible ? ((totals.present + totals.late) / totals.possible) * 100 : 0,
    daily,
    gender: { male: genderStat('male'), female: genderStat('female') },
  }
}

function genderVerdict(report: Report): string {
  const m = report.gender.male.rate
  const f = report.gender.female.rate
  if (m === null || f === null) return 'Not enough gender data yet to compare boys and girls.'
  const diff = f - m
  if (Math.abs(diff) < 0.5) return 'Boys and girls have almost identical attendance.'
  return `${diff > 0 ? 'Girls' : 'Boys'} are doing better, ahead by ${Math.abs(diff).toFixed(1)} percentage points.`
}

/** Bars for the trend chart: per school day, or per month when viewing all time. */
function trendPoints(report: Report, mode: Mode): { label: string; rate: number }[] {
  if (mode !== 'all') return report.daily.map((d) => ({ label: String(parseISO(d.date).getDate()), rate: d.rate }))
  const byMonth = new Map<string, number[]>()
  for (const d of report.daily) {
    const key = d.date.slice(0, 7)
    byMonth.set(key, [...(byMonth.get(key) ?? []), d.rate])
  }
  return [...byMonth.entries()].map(([key, rates]) => ({
    label: parseISO(`${key}-01`).toLocaleDateString('en-GB', { month: 'short' }),
    rate: rates.reduce((a, b) => a + b, 0) / rates.length,
  }))
}

const pct = (n: number) => `${Math.round(n)}%`

/* ------------------------------------------------------------------ */
/* Small UI pieces                                                     */
/* ------------------------------------------------------------------ */
function PeriodControls({
  mode,
  setMode,
  offset,
  setOffset,
  label,
  allowAll,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  offset: number
  setOffset: (n: number) => void
  label: string
  allowAll?: boolean
}) {
  const modes: { value: Mode; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    ...(allowAll ? [{ value: 'all' as Mode, label: 'All time' }] : []),
  ]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg bg-royal-50 p-1">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              setMode(m.value)
              setOffset(0)
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === m.value ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500 hover:text-royal-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode !== 'all' && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOffset(offset - 1)}
            aria-label="Previous period"
            className="rounded-md p-1.5 text-gray-500 hover:bg-royal-50 hover:text-royal-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-medium text-royal-900">{label}</span>
          <button
            onClick={() => setOffset(offset + 1)}
            disabled={offset >= 0}
            aria-label="Next period"
            className="rounded-md p-1.5 text-gray-500 hover:bg-royal-50 hover:text-royal-700 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-2xl font-semibold text-royal-900">{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function Donut({ slices, centerLabel, centerSub }: { slices: { value: number; color: string }[]; centerLabel: string; centerSub: string }) {
  const r = 42
  const C = 2 * Math.PI * r
  const total = slices.reduce((a, s) => a + s.value, 0)
  let acc = 0
  return (
    <svg viewBox="0 0 100 100" className="h-44 w-44 shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
      {total > 0 &&
        slices.map((s, i) => {
          const len = (s.value / total) * C
          const el = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-acc}
              transform="rotate(-90 50 50)"
            />
          )
          acc += len
          return el
        })}
      <text x="50" y="49" textAnchor="middle" className="fill-royal-900" style={{ fontSize: 14, fontWeight: 700 }}>
        {centerLabel}
      </text>
      <text x="50" y="61" textAnchor="middle" className="fill-gray-500" style={{ fontSize: 5.5 }}>
        {centerSub}
      </text>
    </svg>
  )
}

function RateBar({ label, rate, count, color }: { label: string; rate: number | null; count: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-royal-900">
          {label} <span className="text-xs font-normal text-gray-400">({count})</span>
        </span>
        <span className="font-semibold text-royal-900">{rate === null ? '—' : `${rate.toFixed(1)}%`}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function useAttendanceRange(classId: string, mode: Mode, offset: number) {
  const range = getRange(mode, offset)
  const [rows, setRows] = useState<AttRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    fetchAttendance(classId, range.from, range.to).then((data) => {
      if (!active) return
      setRows(data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [classId, range.from, range.to])
  return { rows, loading, range }
}

/* ------------------------------------------------------------------ */
/* 1. Mark attendance (today only, submitted automatically at 12 PM)   */
/* ------------------------------------------------------------------ */
function MarkAttendance({ classId, students, profileId }: { classId: string; students: Student[]; profileId: string }) {
  const now = useNow()
  const today = toISO(now)
  const isWeekend = now.getDay() === 0 || now.getDay() === 6
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CUTOFF_HOUR, 0, 0)
  const locked = now >= cutoff
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [loaded, setLoaded] = useState(false)
  const [pendingWrites, setPendingWrites] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoaded(false)
    supabase
      .from('attendance')
      .select('student_id, status')
      .eq('class_id', classId)
      .eq('date', today)
      .then(({ data }) => {
        if (!active) return
        const map: Record<string, Status> = {}
        for (const row of data ?? []) map[row.student_id] = row.status as Status
        setMarks(map)
        setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [classId, today])

  async function save(rows: { student_id: string; status: Status }[], previous: Record<string, Status>) {
    if (new Date().getHours() >= CUTOFF_HOUR) {
      setMarks(previous)
      setError('Attendance for today has already been submitted.')
      return
    }
    setError(null)
    setPendingWrites((n) => n + 1)
    const { error: upsertError } = await supabase.from('attendance').upsert(
      rows.map((r) => ({ class_id: classId, student_id: r.student_id, date: today, status: r.status, recorded_by: profileId })),
      { onConflict: 'student_id,date' },
    )
    setPendingWrites((n) => n - 1)
    if (upsertError) {
      setMarks(previous)
      setError(upsertError.message)
    }
  }

  function setMark(studentId: string, status: Status) {
    if (locked || isWeekend) return
    const previous = marks
    setMarks({ ...marks, [studentId]: status })
    save([{ student_id: studentId, status }], previous)
  }

  function markRemainingPresent() {
    if (locked || isWeekend) return
    const remaining = students.filter((s) => !marks[s.id])
    if (remaining.length === 0) return
    const previous = marks
    const next = { ...marks }
    for (const s of remaining) next[s.id] = 'present'
    setMarks(next)
    save(remaining.map((s) => ({ student_id: s.id, status: 'present' as Status })), previous)
  }

  const counts = { present: 0, late: 0, absent: 0 }
  for (const s of students) if (marks[s.id]) counts[marks[s.id]]++
  const unmarked = students.length - (counts.present + counts.late + counts.absent)

  const minsLeft = Math.max(0, Math.ceil((cutoff.getTime() - now.getTime()) / 60000))
  const timeLeft = minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`
  const todayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-royal-900">{todayLabel}</p>
        {!locked && !isWeekend && students.length > 0 && (
          <button onClick={markRemainingPresent} className="text-sm font-medium text-royal-600 hover:text-royal-700 hover:underline">
            Mark remaining present
          </button>
        )}
      </div>

      {isWeekend ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          No school today. Attendance is only taken on weekdays.
        </div>
      ) : locked ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-royal-50 p-3 text-sm text-royal-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Today's attendance was submitted automatically at 12:00 PM and is now locked.
            {unmarked > 0 && ` ${unmarked} unmarked ${unmarked === 1 ? 'student is' : 'students are'} counted absent.`}
          </span>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Marks save as you tap. Attendance is submitted automatically at 12:00 PM (in {timeLeft}); students not marked by then are counted absent.
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <p>
          <span className="font-medium text-green-700">{counts.present + counts.late} present</span>
          {counts.late > 0 && <span className="text-amber-700"> (incl. {counts.late} late)</span>}
          {' · '}
          <span className="font-medium text-red-700">{counts.absent} absent</span>
          {' · '}
          {unmarked} unmarked
        </p>
        <p className="text-xs">
          {pendingWrites > 0 ? (
            <span className="inline-flex items-center gap-1 text-royal-600">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving...
            </span>
          ) : locked || isWeekend ? null : (
            'All changes saved'
          )}
        </p>
      </div>

      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="w-14 px-4 py-3">SN</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  No students in your class yet.
                </td>
              </tr>
            ) : (
              students.map((s, i) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-royal-900">{s.full_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {locked || isWeekend ? (
                        marks[s.id] ? (
                          <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${STATUS_STYLES[marks[s.id]]}`}>
                            {STATUS_OPTIONS.find((o) => o.value === marks[s.id])?.label}
                          </span>
                        ) : isWeekend ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                            Not marked · absent
                          </span>
                        )
                      ) : (
                        STATUS_OPTIONS.map((opt) => {
                          const active = marks[s.id] === opt.value
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setMark(s.id, opt.value)}
                              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                active ? STATUS_STYLES[opt.value] : 'border-gray-200 text-gray-400 hover:border-gray-300'
                              }`}
                            >
                              <opt.icon className="h-3.5 w-3.5" />
                              {opt.label}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Late counts as present.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Attendance history (week / month)                                */
/* ------------------------------------------------------------------ */
const CELL_STYLES: Record<Status, string> = {
  present: 'bg-green-100 text-green-700',
  late: 'bg-amber-100 text-amber-700',
  absent: 'bg-red-100 text-red-600',
}
const CELL_LETTER: Record<Status, string> = { present: 'P', late: 'L', absent: 'A' }

function HistoryPanel({ classId, students }: { classId: string; students: Student[] }) {
  const [mode, setMode] = useState<Mode>('week')
  const [offset, setOffset] = useState(0)
  const { rows, loading, range } = useAttendanceRange(classId, mode, offset)
  const report = buildReport(students, rows)

  return (
    <div>
      <PeriodControls mode={mode} setMode={setMode} offset={offset} setOffset={setOffset} label={range.label} />

      {loading ? (
        <div className="mt-4 rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">Loading...</div>
      ) : report.days.length === 0 ? (
        <div className="mt-4 rounded-xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
          No attendance was recorded for this {mode}.
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-gray-500">
            <span className="font-medium text-royal-900">{report.days.length}</span> school {report.days.length === 1 ? 'day' : 'days'} ·
            class average <span className="font-medium text-royal-900">{pct(report.rate)}</span>
            <span className="ml-2 text-xs text-gray-400">P present · L late (counts as present) · A absent</span>
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs text-gray-500">
                <tr>
                  <th className="sticky left-0 z-10 w-12 bg-white px-3 py-3 uppercase">SN</th>
                  <th className="sticky left-12 z-10 min-w-[160px] bg-white px-3 py-3 uppercase">Name</th>
                  {report.days.map((d) => {
                    const date = parseISO(d)
                    return (
                      <th key={d} className="px-1 py-2 text-center font-medium">
                        <span className="block text-[10px] uppercase text-gray-400">
                          {date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, mode === 'week' ? 3 : 1)}
                        </span>
                        {date.getDate()}
                      </th>
                    )
                  })}
                  <th className="whitespace-nowrap px-3 py-3 text-center uppercase">Present</th>
                  <th className="px-3 py-3 text-center uppercase">%</th>
                </tr>
              </thead>
              <tbody>
                {report.stats.map((s, i) => (
                  <tr key={s.student.id} className="border-b border-gray-50 last:border-0">
                    <td className="sticky left-0 bg-white px-3 py-2.5 text-gray-500">{i + 1}</td>
                    <td className="sticky left-12 bg-white px-3 py-2.5 font-medium text-royal-900">{s.student.full_name}</td>
                    {report.days.map((d) => {
                      const st: Status = report.cells.get(s.student.id)?.get(d) ?? 'absent'
                      return (
                        <td key={d} className="px-1 py-2 text-center">
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${CELL_STYLES[st]}`}
                          >
                            {CELL_LETTER[st]}
                          </span>
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-center font-medium text-royal-900">
                      {s.attended} / {s.days}
                      {s.late > 0 && <span className="block text-[10px] font-normal text-amber-600">{s.late} late</span>}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-center font-semibold ${
                        s.rate >= 90 ? 'text-green-700' : s.rate >= 75 ? 'text-amber-600' : 'text-red-600'
                      }`}
                    >
                      {pct(s.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* PDF export                                                          */
/* ------------------------------------------------------------------ */
async function downloadStatsPdf(className: string, periodLabel: string, mode: Mode, report: Report) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const M = 15
  const hex = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  let y = 0

  const ensure = (needed: number) => {
    if (y + needed > H - 18) {
      doc.addPage()
      y = 20
    }
  }
  const section = (title: string) => {
    ensure(14)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(30, 58, 138)
    doc.text(title, M, y)
    y += 6
    doc.setTextColor(40, 40, 40)
  }

  // Header
  doc.setFillColor(30, 58, 138)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Attendance Report', M, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('SAT ROYAL HUB', M, 20)
  doc.text(`${className}  |  ${periodLabel}`, M, 26)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, W - M, 26, { align: 'right' })
  y = 40

  // KPI boxes
  const kpis = [
    ['Average attendance', `${report.rate.toFixed(1)}%`],
    ['School days', String(report.days.length)],
    ['Present (incl. late)', String(report.totals.present + report.totals.late)],
    ['Absent', String(report.totals.absent)],
  ]
  const boxW = (W - 2 * M - 9) / 4
  kpis.forEach(([label, value], i) => {
    const x = M + i * (boxW + 3)
    doc.setFillColor(238, 242, 255)
    doc.roundedRect(x, y, boxW, 20, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(30, 58, 138)
    doc.text(value, x + boxW / 2, y + 9, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(label, x + boxW / 2, y + 15, { align: 'center' })
  })
  y += 30

  // Pie chart
  section('Attendance breakdown')
  const slices = [
    { label: 'Present (on time)', value: report.totals.present, color: CHART_COLORS.present },
    { label: 'Late (counts as present)', value: report.totals.late, color: CHART_COLORS.late },
    { label: 'Absent', value: report.totals.absent, color: CHART_COLORS.absent },
  ]
  const total = slices.reduce((a, s) => a + s.value, 0)
  const cx = M + 24
  const cy = y + 24
  const radius = 22
  if (total === 0) {
    doc.setFillColor(229, 231, 235)
    doc.circle(cx, cy, radius, 'F')
  } else {
    let angle = -Math.PI / 2
    for (const s of slices) {
      if (s.value === 0) continue
      const sweep = (s.value / total) * Math.PI * 2
      doc.setFillColor(...hex(s.color))
      if (s.value === total) {
        doc.circle(cx, cy, radius, 'F')
      } else {
        const pts: [number, number][] = [[cx, cy]]
        const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 90)))
        for (let k = 0; k <= steps; k++) {
          const a = angle + (sweep * k) / steps
          pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
        }
        const rel = pts.slice(1).map((p, k) => [p[0] - pts[k][0], p[1] - pts[k][1]])
        doc.lines(rel, pts[0][0], pts[0][1], [1, 1], 'F', true)
      }
      angle += sweep
    }
  }
  slices.forEach((s, i) => {
    const ly = y + 12 + i * 10
    doc.setFillColor(...hex(s.color))
    doc.rect(M + 60, ly - 3.5, 4.5, 4.5, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40, 40, 40)
    doc.text(`${s.label}: ${s.value} (${total ? ((s.value / total) * 100).toFixed(1) : '0.0'}%)`, M + 67, ly)
  })
  y += 52

  // Gender comparison
  section('Boys vs girls')
  const bars: [string, GenderStat, string][] = [
    ['Boys', report.gender.male, '#3b82f6'],
    ['Girls', report.gender.female, '#ec4899'],
  ]
  bars.forEach(([label, g, color], i) => {
    const by = y + i * 10
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40, 40, 40)
    doc.text(`${label} (${g.count})`, M, by + 4)
    doc.setFillColor(229, 231, 235)
    doc.roundedRect(M + 32, by, 100, 5, 2, 2, 'F')
    if (g.rate !== null && g.rate > 0) {
      doc.setFillColor(...hex(color))
      doc.roundedRect(M + 32, by, Math.max(2, g.rate), 5, 2, 2, 'F')
    }
    doc.text(g.rate === null ? '—' : `${g.rate.toFixed(1)}%`, M + 137, by + 4)
  })
  y += 24
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(10)
  doc.text(genderVerdict(report), M, y)
  y += 10

  // Trend chart
  const trend = trendPoints(report, mode)
  if (trend.length > 0) {
    section(mode === 'all' ? 'Monthly average attendance' : 'Daily attendance rate')
    ensure(50)
    const chartH = 34
    const chartW = W - 2 * M
    const baseY = y + chartH
    doc.setDrawColor(210, 210, 210)
    doc.setLineWidth(0.2)
    for (const g of [0, 50, 100]) {
      const gy = baseY - (g / 100) * chartH
      doc.line(M, gy, M + chartW, gy)
      doc.setFontSize(7)
      doc.setTextColor(140, 140, 140)
      doc.text(`${g}%`, M - 1, gy + 1, { align: 'right' })
    }
    const slot = chartW / trend.length
    const bw = Math.min(9, slot * 0.7)
    trend.forEach((p, i) => {
      const bh = (p.rate / 100) * chartH
      const bx = M + i * slot + (slot - bw) / 2
      const color = p.rate >= 90 ? CHART_COLORS.present : p.rate >= 75 ? CHART_COLORS.late : CHART_COLORS.absent
      doc.setFillColor(...hex(color))
      if (bh > 0) doc.rect(bx, baseY - bh, bw, bh, 'F')
      doc.setFontSize(6.5)
      doc.setTextColor(110, 110, 110)
      doc.text(p.label, bx + bw / 2, baseY + 4, { align: 'center' })
    })
    y = baseY + 12
  }

  // Student table
  const cols: { title: string; w: number; align: 'left' | 'center' }[] = [
    { title: 'SN', w: 12, align: 'left' },
    { title: 'Name', w: 68, align: 'left' },
    { title: 'Gender', w: 20, align: 'left' },
    { title: 'Present', w: 22, align: 'center' },
    { title: 'Late', w: 16, align: 'center' },
    { title: 'Absent', w: 20, align: 'center' },
    { title: 'Rate', w: 22, align: 'center' },
  ]
  const drawHeader = () => {
    doc.setFillColor(30, 58, 138)
    doc.rect(M, y, W - 2 * M, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    let x = M
    for (const c of cols) {
      doc.text(c.title, c.align === 'center' ? x + c.w / 2 : x + 2, y + 5.5, { align: c.align })
      x += c.w
    }
    y += 8
  }
  section('Student attendance')
  ensure(24)
  drawHeader()
  report.stats.forEach((s, i) => {
    if (y + 7 > H - 18) {
      doc.addPage()
      y = 20
      drawHeader()
    }
    if (i % 2 === 1) {
      doc.setFillColor(245, 247, 255)
      doc.rect(M, y, W - 2 * M, 7, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 40)
    const cells = [
      String(i + 1),
      s.student.full_name,
      s.student.gender === 'male' ? 'Male' : s.student.gender === 'female' ? 'Female' : '-',
      `${s.attended} / ${s.days}`,
      String(s.late),
      String(s.absent),
      `${Math.round(s.rate)}%`,
    ]
    let x = M
    cols.forEach((c, k) => {
      if (k === 6) doc.setTextColor(...hex(s.rate >= 90 ? '#15803d' : s.rate >= 75 ? '#b45309' : '#dc2626'))
      else doc.setTextColor(40, 40, 40)
      doc.text(cells[k], c.align === 'center' ? x + c.w / 2 : x + 2, y + 5, { align: c.align, maxWidth: c.w - 3 })
      x += c.w
    })
    y += 7
  })

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(`Late is counted as present. Page ${p} of ${pages}`, W / 2, H - 8, { align: 'center' })
  }

  const safe = (t: string) => t.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  doc.save(`attendance-${safe(className)}-${safe(periodLabel)}.pdf`)
}

/* ------------------------------------------------------------------ */
/* 3. Attendance stats                                                 */
/* ------------------------------------------------------------------ */
function StatsPanel({ classId, className, students }: { classId: string; className: string; students: Student[] }) {
  const [mode, setMode] = useState<Mode>('month')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const { rows, loading, range } = useAttendanceRange(classId, mode, offset)
  const report = buildReport(students, rows)
  const trend = trendPoints(report, mode)
  const attended = report.totals.present + report.totals.late
  const lowest = report.stats.filter((s) => s.rate < 80).sort((a, b) => a.rate - b.rate).slice(0, 5)
  const m = report.gender.male
  const f = report.gender.female

  async function exportPdf() {
    setExporting(true)
    try {
      await downloadStatsPdf(className, range.label, mode, report)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodControls mode={mode} setMode={setMode} offset={offset} setOffset={setOffset} label={range.label} allowAll />
        <button
          onClick={exportPdf}
          disabled={loading || report.days.length === 0 || exporting}
          className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download PDF
        </button>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">Loading...</div>
      ) : report.days.length === 0 ? (
        <div className="mt-4 rounded-xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
          No attendance has been recorded for this period.
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Average attendance" value={`${report.rate.toFixed(1)}%`} hint="Late counts as present" />
            <Kpi label="School days" value={String(report.days.length)} />
            <Kpi label="Present (incl. late)" value={String(attended)} hint={`${report.totals.late} late`} />
            <Kpi label="Absent" value={String(report.totals.absent)} hint="student-days" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-royal-900">Attendance breakdown</p>
              <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
                <Donut
                  slices={[
                    { value: report.totals.present, color: CHART_COLORS.present },
                    { value: report.totals.late, color: CHART_COLORS.late },
                    { value: report.totals.absent, color: CHART_COLORS.absent },
                  ]}
                  centerLabel={pct(report.rate)}
                  centerSub="attendance"
                />
                <ul className="space-y-2 text-sm">
                  {[
                    ['Present (on time)', report.totals.present, CHART_COLORS.present],
                    ['Late (counts as present)', report.totals.late, CHART_COLORS.late],
                    ['Absent', report.totals.absent, CHART_COLORS.absent],
                  ].map(([label, value, color]) => (
                    <li key={label as string} className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color as string }} />
                      <span className="text-gray-600">{label}</span>
                      <span className="font-semibold text-royal-900">
                        {value as number}
                        <span className="ml-1 text-xs font-normal text-gray-400">
                          ({report.totals.possible ? (((value as number) / report.totals.possible) * 100).toFixed(1) : '0.0'}%)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-royal-900">Boys vs girls</p>
              <div className="mt-4 space-y-4">
                <RateBar label="Boys" rate={m.rate} count={m.count} color="#3b82f6" />
                <RateBar label="Girls" rate={f.rate} count={f.count} color="#ec4899" />
              </div>
              <div className="mt-5 flex items-start gap-2 rounded-lg bg-royal-50 p-3 text-sm text-royal-800">
                <Trophy className="mt-0.5 h-4 w-4 shrink-0" />
                {genderVerdict(report)}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-royal-900">
              {mode === 'all' ? 'Monthly average attendance' : 'Daily attendance rate'}
            </p>
            <div className="mt-3 overflow-x-auto">
              <div className="flex h-44 items-end gap-1.5" style={{ minWidth: trend.length * 26 }}>
                {trend.map((p, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${p.label}: ${p.rate.toFixed(0)}%`}>
                    <span className="mb-1 text-[10px] text-gray-500">{Math.round(p.rate)}</span>
                    <div
                      className="w-full max-w-[28px] rounded-t"
                      style={{
                        height: `${Math.max(2, p.rate * 1.2)}px`,
                        backgroundColor: p.rate >= 90 ? CHART_COLORS.present : p.rate >= 75 ? CHART_COLORS.late : CHART_COLORS.absent,
                      }}
                    />
                    <span className="mt-1 text-[10px] text-gray-500">{p.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-400">Green 90%+ · Amber 75–89% · Red below 75%</p>
          </div>

          <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-royal-900">Needs attention (below 80%)</p>
            {lowest.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Great news: every student is at 80% or above.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {lowest.map((s) => (
                  <li key={s.student.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-royal-900">{s.student.full_name}</span>
                    <span className="text-gray-500">
                      {s.absent} absent ·{' '}
                      <span className="font-semibold text-red-600">{pct(s.rate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
const TABS: { value: Tab; title: string; desc: string; icon: typeof Check }[] = [
  { value: 'mark', title: 'Mark Attendance', desc: "Take today's register", icon: ClipboardCheck },
  { value: 'history', title: 'Attendance History', desc: 'Review by week or month', icon: History },
  { value: 'stats', title: 'Attendance Stats', desc: 'Charts, averages and PDF', icon: ChartPie },
]

export default function TeacherAttendance() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('mark')
  const [classId, setClassId] = useState<string | null>(null)
  const [className, setClassName] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function loadClass() {
      if (!profile) return
      const { data: myClass } = await supabase
        .from('classes')
        .select('id, name')
        .eq('teacher_id', profile.id)
        .maybeSingle()
      if (!active) return
      if (myClass) {
        setClassId(myClass.id)
        setClassName(myClass.name)
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, full_name, admission_number, gender')
          .eq('class_id', myClass.id)
          .eq('is_active', true)
          .order('full_name')
        if (active) setStudents(studentRows ?? [])
      }
      setLoading(false)
    }
    loadClass()
    return () => {
      active = false
    }
  }, [profile])

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Attendance {className && `· ${className}`}</h1>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map((t) => {
          const active = tab === t.value
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left shadow-sm transition ${
                active ? 'border-royal-600 bg-royal-50' : 'border-transparent bg-white hover:bg-royal-50/50'
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                  active ? 'bg-royal-600 text-white' : 'bg-royal-50 text-royal-600'
                }`}
              >
                <t.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-royal-900">{t.title}</span>
                <span className="block text-xs text-gray-500">{t.desc}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">Loading...</div>
        ) : !classId || !profile ? (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">You haven't been assigned a class yet. Contact your administrator.</p>
          </div>
        ) : tab === 'mark' ? (
          <MarkAttendance classId={classId} students={students} profileId={profile.id} />
        ) : tab === 'history' ? (
          <HistoryPanel classId={classId} students={students} />
        ) : (
          <StatsPanel classId={classId} className={className ?? 'Class'} students={students} />
        )}
      </div>
    </div>
  )
}