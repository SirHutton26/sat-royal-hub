import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { localISO } from '@/lib/attendance'
import schoolLogo from '@/assets/school-logo.png'

type Status = 'present' | 'absent' | 'late'
interface Student {
  id: string
  full_name: string
  gender: string | null
}

const WEEKS_PER_PAGE = 4
const LETTERS = ['M', 'T', 'W', 'T', 'F']

const monday = (d: Date) => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
const isBoy = (g: string | null) => /^m/i.test(g ?? '')
const isGirl = (g: string | null) => /^f/i.test(g ?? '')
const present = (s?: Status) => s === 'present' || s === 'late'
const short = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`

export default function TeacherAttendanceTerm() {
  const { profile } = useAuth()
  const [classId, setClassId] = useState<string | null>(null)
  const [className, setClassName] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [term, setTerm] = useState('')
  const [year, setYear] = useState('')
  const [start, setStart] = useState<string>(() => localStorage.getItem('sat-term-start') ?? '')
  const [weeks, setWeeks] = useState(() => Number(localStorage.getItem('sat-term-weeks') ?? 0))
  const [records, setRecords] = useState<Map<string, Status>>(new Map())
  const [loading, setLoading] = useState(true)

  // class, students, term, and a default start date (earliest register entry)
  useEffect(() => {
    if (!profile) return
    let alive = true
    ;(async () => {
      const [{ data: cls }, { data: set }] = await Promise.all([
        supabase.from('classes').select('id, name').eq('teacher_id', profile.id).maybeSingle(),
        supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
      ])
      if (!alive) return
      if (set) {
        setTerm(set.current_term ?? '')
        setYear(set.current_academic_year ?? '')
      }
      if (!cls) return setLoading(false)
      setClassId(cls.id)
      setClassName(cls.name)
      const [{ data: st }, { data: first }] = await Promise.all([
        supabase.from('students').select('id, full_name, gender').eq('class_id', cls.id).eq('is_active', true).order('full_name'),
        supabase.from('attendance').select('date').eq('class_id', cls.id).order('date', { ascending: true }).limit(1),
      ])
      if (!alive) return
      setStudents((st ?? []) as Student[])
      if (!localStorage.getItem('sat-term-start')) {
        const d = first?.[0]?.date ? monday(new Date(first[0].date + 'T00:00:00')) : monday(new Date())
        setStart(localISO(d))
      }
      if (!Number(localStorage.getItem('sat-term-weeks'))) setWeeks(0) // 0 = up to this week
      if (!first?.length) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [profile])

  const startDate = useMemo(() => (start ? monday(new Date(start + 'T00:00:00')) : null), [start])
  const weekCount = useMemo(() => {
    if (!startDate) return 0
    if (weeks > 0) return weeks
    const diff = Math.floor((monday(new Date()).getTime() - startDate.getTime()) / (7 * 86400000)) + 1
    return Math.min(Math.max(diff, 1), 16)
  }, [startDate, weeks])

  // attendance for the whole period (paged: the API returns at most 1000 rows at a time)
  useEffect(() => {
    if (!classId || !startDate || !weekCount) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const from = localISO(startDate)
      const to = localISO(addDays(startDate, weekCount * 7 - 1))
      const map = new Map<string, Status>()
      for (let o = 0; ; o += 1000) {
        const { data } = await supabase
          .from('attendance')
          .select('student_id, date, status')
          .eq('class_id', classId)
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .range(o, o + 999)
        for (const r of data ?? []) map.set(`${r.student_id}|${r.date}`, r.status as Status)
        if ((data?.length ?? 0) < 1000) break
      }
      if (!alive) return
      setRecords(map)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [classId, startDate, weekCount])

  // which days the register was taken (any entry for the class that day)
  const openDays = useMemo(() => {
    const s = new Set<string>()
    for (const k of records.keys()) s.add(k.split('|')[1])
    return s
  }, [records])

  const weekList = useMemo(
    () => Array.from({ length: weekCount }, (_, w) => Array.from({ length: 5 }, (_, d) => addDays(startDate!, w * 7 + d))),
    [startDate, weekCount],
  )

  const st = (sid: string, d: Date) => records.get(`${sid}|${localISO(d)}`)
  const daysPresent = (sid: string, days: Date[]) => days.filter((d) => present(st(sid, d))).length
  const dayCount = (days: Date[], pick: (g: string | null) => boolean | 'all') =>
    days.map((d) => students.filter((s) => (pick === (undefined as never) ? true : pick(s.gender)) && present(st(s.id, d))).length)
  const timesOpen = (days: Date[]) => days.filter((d) => openDays.has(localISO(d))).length

  const blocks: Date[][][] = []
  for (let i = 0; i < weekList.length; i += WEEKS_PER_PAGE) blocks.push(weekList.slice(i, i + WEEKS_PER_PAGE))

  // weekly summary for the last page
  const summary = weekList.map((days, i) => {
    const boys = dayCount(days, isBoy).reduce((a, b) => a + b, 0)
    const girls = dayCount(days, isGirl).reduce((a, b) => a + b, 0)
    const total = students.reduce((a, s) => a + daysPresent(s.id, days), 0)
    const open = timesOpen(days)
    return { week: i + 1, open, boys, girls, total, avg: open ? total / open : 0 }
  })
  const termOpen = summary.reduce((a, r) => a + r.open, 0)
  const termTotal = summary.reduce((a, r) => a + r.total, 0)

  const cell = 'border border-gray-700 text-center text-[10px] leading-tight'
  const shade = (d: Date) => (openDays.has(localISO(d)) ? '' : 'bg-gray-200')

  if (!profile) return null
  return (
    <div>
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm } }`}</style>
      <div className="print:hidden">
        <Link to="/teacher/attendance/register" className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-royal-900">Term Attendance Register</h1>
        <p className="mt-1 text-sm text-gray-500">Printable register in the traditional book layout: / present, L late (counted present), O absent, grey = no register taken.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 shadow-sm">
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-500">Term commencing (Monday)</span>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                localStorage.setItem('sat-term-start', e.target.value)
              }}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-500">Weeks</span>
            <select
              value={weeks}
              onChange={(e) => {
                setWeeks(Number(e.target.value))
                localStorage.setItem('sat-term-weeks', e.target.value)
              }}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5"
            >
              <option value={0}>Up to this week</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
        {loading && <Loader2 className="mt-4 h-5 w-5 animate-spin text-royal-600" />}
      </div>

      {!loading && classId && startDate && (
        <div className="mt-4 space-y-6 print:mt-0 print:space-y-0">
          {blocks.map((block, bi) => (
            <section key={bi} className="overflow-x-auto rounded-xl bg-white p-3 shadow-sm print:break-after-page print:rounded-none print:p-0 print:shadow-none">
              <div className="mb-2 flex items-center gap-3">
                <img src={schoolLogo} alt="" className="h-10 w-10 object-contain" />
                <div className="flex-1">
                  <p className="text-sm font-bold uppercase tracking-wide text-royal-900">SAT Royal Basic School - Attendance Register</p>
                  <p className="text-xs text-gray-600">
                    Class: <b>{className}</b> &nbsp; {term} {year} &nbsp; Teacher: {profile.full_name} &nbsp; Term commencing: {startDate.toLocaleDateString('en-GB')}
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  Page {bi + 1}/{blocks.length}
                </p>
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${cell} w-7`}>SN</th>
                    <th rowSpan={2} className={`${cell} min-w-[150px] text-left`}>NAME</th>
                    {block.map((days, wi) => (
                      <th key={wi} colSpan={6} className={`${cell} bg-gray-100 py-0.5`}>
                        WEEK {bi * WEEKS_PER_PAGE + wi + 1} ({short(days[0])} - {short(days[4])})
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {block.map((days, wi) => (
                      <Fragment key={wi}>
                        {days.map((d, di) => (
                          <th key={di} className={`${cell} w-6 py-0.5 font-semibold`}>
                            {LETTERS[di]}
                            <span className="block text-[8px] font-normal">{d.getDate()}</span>
                          </th>
                        ))}
                        <th className={`${cell} w-7 bg-gray-100`}>TOT</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, i) => (
                    <tr key={s.id} className="break-inside-avoid">
                      <td className={cell}>{i + 1}</td>
                      <td className={`${cell} px-1 text-left text-[10px] uppercase`}>{s.full_name}</td>
                      {block.map((days, wi) => (
                        <Fragment key={wi}>
                          {days.map((d, di) => {
                            const v = st(s.id, d)
                            return (
                              <td key={di} className={`${cell} h-[15px] ${shade(d)}`}>
                                {v === 'present' ? '/' : v === 'late' ? 'L' : v === 'absent' ? 'O' : ''}
                              </td>
                            )
                          })}
                          <td className={`${cell} bg-gray-100 font-semibold`}>{timesOpen(days) ? daysPresent(s.id, days) : ''}</td>
                        </Fragment>
                      ))}
                    </tr>
                  ))}
                  {([
                    ['BOYS PRESENT', isBoy],
                    ['GIRLS PRESENT', isGirl],
                    ['TOTAL PRESENT', undefined],
                  ] as const).map(([label, pick]) => (
                    <tr key={label} className="break-inside-avoid bg-gray-50 font-semibold">
                      <td colSpan={2} className={`${cell} px-1 text-right`}>{label}</td>
                      {block.map((days, wi) => {
                        const counts = days.map((d) => students.filter((s) => (pick ? pick(s.gender) : true) && present(st(s.id, d))).length)
                        return (
                          <Fragment key={wi}>
                            {counts.map((c, di) => (
                              <td key={di} className={`${cell} ${shade(days[di])}`}>{openDays.has(localISO(days[di])) ? c : ''}</td>
                            ))}
                            <td className={`${cell} bg-gray-100`}>{timesOpen(days) ? counts.reduce((a, b) => a + b, 0) : ''}</td>
                          </Fragment>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="break-inside-avoid font-semibold">
                    <td colSpan={2} className={`${cell} px-1 text-right`}>TIMES OPEN</td>
                    {block.map((days, wi) => (
                      <td key={wi} colSpan={6} className={cell}>{timesOpen(days)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>

              {bi === blocks.length - 1 && (
                <div className="mt-4 break-inside-avoid">
                  <p className="mb-1 text-xs font-bold uppercase text-royal-900">Weekly totals</p>
                  <table className="border-collapse">
                    <thead>
                      <tr>
                        {['Week', 'Times open', 'Boys', 'Girls', 'Total attendance', 'Average daily'].map((h) => (
                          <th key={h} className={`${cell} bg-gray-100 px-2 py-0.5`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r) => (
                        <tr key={r.week}>
                          <td className={`${cell} px-2`}>{r.week}</td>
                          <td className={cell}>{r.open}</td>
                          <td className={cell}>{r.boys}</td>
                          <td className={cell}>{r.girls}</td>
                          <td className={cell}>{r.total}</td>
                          <td className={cell}>{r.open ? r.avg.toFixed(1) : ''}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-100 font-bold">
                        <td className={`${cell} px-2`}>TERM</td>
                        <td className={cell}>{termOpen}</td>
                        <td className={cell}>{summary.reduce((a, r) => a + r.boys, 0)}</td>
                        <td className={cell}>{summary.reduce((a, r) => a + r.girls, 0)}</td>
                        <td className={cell}>{termTotal}</td>
                        <td className={cell}>{termOpen ? (termTotal / termOpen).toFixed(1) : ''}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-6 text-xs text-gray-600">Class teacher's signature: ______________________ &nbsp;&nbsp; Headteacher's signature: ______________________</p>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
