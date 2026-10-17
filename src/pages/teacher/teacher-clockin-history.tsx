import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { isWeekday, localISO, parseISODate, staffStatusClass, staffStatusLabel } from '@/lib/attendance'
import { isSchoolDay, schoolDaysBetween, useTermDates } from '@/lib/terms'

interface Rec {
  date: string
  clock_in_at: string | null
  clock_out_at: string | null
  status: string
}

const TERM_START_KEY = 'sat-term-start' // shared with the term register
const box = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')

export default function TeacherClockInHistory() {
  const { profile } = useAuth()
  const { term, holidays } = useTermDates()
  const [records, setRecords] = useState<Rec[]>([])
  const [loading, setLoading] = useState(true)
  const [termStart, setTermStart] = useState(() => {
    try {
      return localStorage.getItem(TERM_START_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [month, setMonth] = useState(() => localISO().slice(0, 7)) // YYYY-MM
  const todayISO = localISO()

  useEffect(() => {
    if (!profile) return
    void supabase
      .from('staff_attendance')
      .select('date, clock_in_at, clock_out_at, status')
      .eq('teacher_id', profile.id)
      .order('date', { ascending: false })
      .limit(400)
      .then(({ data }) => {
        const list = ((data ?? []) as Rec[]).filter((r) => r.clock_in_at && isWeekday(r.date))
        setRecords(list)
        setLoading(false)
      })
  }, [profile])

  // Term dates come from the admin's settings; without them, fall back to a date picked on this device
  const adminTerm = !!term
  const start = term?.start_date ?? (termStart || (records.length ? records[records.length - 1].date : todayISO))
  const termEnd = term && term.end_date < todayISO ? term.end_date : todayISO
  const counted = useMemo(() => records.filter((r) => isSchoolDay(r.date, holidays)), [records, holidays])

  const stats = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = `${month}-01`
    const last = localISO(new Date(y, m, 0))
    const from = first < start ? start : first
    const to = last > termEnd ? termEnd : last
    const present = counted.filter((r) => r.date >= from && r.date <= to).length
    const days = from <= to ? schoolDaysBetween(from, to, holidays) : 0
    const termRecs = counted.filter((r) => r.date >= start && r.date <= termEnd).length
    const termDays = start <= termEnd ? schoolDaysBetween(start, termEnd, holidays) : 0
    return { present, days, termRecs, termDays }
  }, [counted, holidays, month, start, termEnd, todayISO])

  function shiftMonth(delta: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const next = localISO(d).slice(0, 7)
    if (next <= todayISO.slice(0, 7)) setMonth(next)
  }
  const monthLabel = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const shown = records.filter((r) => r.date.startsWith(month))

  return (
    <div>
      <Link to="/teacher/clock-in" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="text-xl font-semibold text-royal-900">Clock-In History</h1>
      <p className="mt-1 text-xs text-gray-500">Only school days are counted: Monday to Friday, not holidays. Late arrivals count as present.</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-royal-900">
              <CalendarDays className="h-5 w-5 text-royal-600" /> Present this month
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-lg border border-gray-200 p-1 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => shiftMonth(1)}
                disabled={month >= todayISO.slice(0, 7)}
                aria-label="Next month"
                className="rounded-lg border border-gray-200 p-1 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="mt-3 text-4xl font-extrabold text-royal-900">
            {stats.present}
            <span className="ml-1 text-base font-semibold text-gray-400">/ {stats.days} days</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">{monthLabel}</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-royal-900">
            <CalendarRange className="h-5 w-5 text-violet-500" /> Present this term
          </div>
          <p className="mt-3 text-4xl font-extrabold text-royal-900">
            {stats.termRecs}
            <span className="ml-1 text-base font-semibold text-gray-400">/ {stats.termDays} days</span>
          </p>
          {adminTerm ? (
            <p className="mt-1 text-xs text-gray-500">{term!.term}, {term!.academic_year}: {parseISODate(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to {parseISODate(term!.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
          ) : (
          <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            Term started
            <input
              type="date"
              value={start}
              max={todayISO}
              onChange={(e) => {
                setTermStart(e.target.value)
                try {
                  localStorage.setItem(TERM_START_KEY, e.target.value)
                } catch {
                  /* ignore */
                }
              }}
              className={`${box} py-1 text-xs`}
            />
          </label>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-center">Check-in</th>
              <th className="px-4 py-3 text-center">Sign-out</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No clock-ins in {monthLabel}.</td></tr>
            ) : (
              shown.map((r) => (
                <tr key={r.date} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-royal-900">
                    {parseISODate(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${staffStatusClass(r.status)}`}>{staffStatusLabel(r.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">{fmtTime(r.clock_in_at)}</td>
                  <td className="px-4 py-3 text-center">{fmtTime(r.clock_out_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}