import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { lastWeekday, localISO, staffStatusClass, staffStatusLabel } from '@/lib/attendance'
import { ROLE_LABEL, classRows, loadDay, pctPresent, staffSummary, type Day } from '@/lib/headteacher'

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' }) : '-')

export default function HeadteacherToday() {
  const [date, setDate] = useState(() => lastWeekday())
  const [day, setDay] = useState<Day | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadDay(date).then((d) => {
      if (!alive) return
      setDay(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [date])

  const staff = day?.staff ?? []
  const ss = day ? staffSummary(day, date) : null
  const recOf = ss?.recOf ?? new Map()
  const absentNow = ss?.absentNow ?? false
  const sPresent = ss?.present ?? 0
  const sLate = ss?.late ?? 0
  const sVeryLate = ss?.veryLate ?? 0
  const sAbsent = ss?.absent ?? 0
  const teacherName = (id: string | null) => {
    const t = staff.find((x) => x.id === id)
    return t ? t.full_name || t.email || '' : ''
  }
  const rows = useMemo(() => (day ? classRows(day) : []), [day])
  const tot = rows.reduce(
    (a, r) => ({ roll: a.roll + r.roll, present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent, notMarked: a.notMarked + r.notMarked, boys: a.boys + r.boys, girls: a.girls + r.girls }),
    { roll: 0, present: 0, late: 0, absent: 0, notMarked: 0, boys: 0, girls: 0 },
  )
  const pct = pctPresent

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Attendance</h1>
          <p className="mt-1 text-sm text-gray-500">Staff and student attendance for the day.</p>
        </div>
        <input type="date" value={date} max={localISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      </div>

      {loading ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          {/* Overview */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Staff present', sPresent + sLate + sVeryLate, 'text-green-600', `${sLate + sVeryLate} came late`],
              ['Staff absent', sAbsent, 'text-gray-800', absentNow ? 'No check-in' : 'Check-in open until 12:00'],
              ['Students present', tot.present + tot.late, 'text-royal-700', `of ${tot.roll} on roll`],
              ['Students absent', tot.absent, 'text-red-600', tot.notMarked ? `${tot.notMarked} not marked yet` : 'All marked'],
            ].map(([k, v, c, sub]) => (
              <div key={String(k)} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className={`mt-1 text-2xl font-bold ${c}`}>{v}</p>
                <p className="text-xs text-gray-400">{sub}</p>
              </div>
            ))}
          </div>

          {/* Staff */}
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-royal-900">Staff attendance</h2>
              <div className="flex gap-3 text-xs font-semibold">
                <span className="text-green-600">{sPresent} present</span>
                <span className="text-orange-500">{sLate} late</span>
                <span className="text-red-600">{sVeryLate} very late</span>
                <span className="text-gray-800">{sAbsent} absent</span>
              </div>
            </div>
            <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-royal-600 text-white">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Check-in</th>
                    <th className="px-4 py-3 font-semibold">Sign-out</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => {
                    const r = recOf.get(s.id)
                    return (
                      <tr key={s.id} className="border-t border-gray-100">
                        <td className="px-4 py-2.5 font-medium text-royal-900">
                          {s.full_name || s.email}
                          {s.role !== 'teacher' && <span className="ml-2 text-xs font-normal text-gray-400">{ROLE_LABEL[s.role] ?? s.role}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{time(r?.clock_in_at ?? null)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{time(r?.clock_out_at ?? null)}</td>
                        <td className="px-4 py-2.5">
                          {r ? (
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${staffStatusClass(r.status)}`}>{staffStatusLabel(r.status)}</span>
                          ) : absentNow ? (
                            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-semibold text-white">Absent</span>
                          ) : (
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Not clocked in yet</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {staff.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No active staff found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Students by class */}
          <section className="mt-6">
            <h2 className="font-semibold text-royal-900">Student attendance by class</h2>
            <p className="text-xs text-gray-500">Late counts as present. Tap a class to see who is absent or late.</p>
            <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-royal-600 text-white">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Class</th>
                    <th className="px-2 py-3 text-right font-semibold">Roll</th>
                    <th className="px-2 py-3 text-right font-semibold">Present</th>
                    <th className="px-2 py-3 text-right font-semibold">Late</th>
                    <th className="px-2 py-3 text-right font-semibold">Absent</th>
                    <th className="px-2 py-3 text-right font-semibold">Boys</th>
                    <th className="px-2 py-3 text-right font-semibold">Girls</th>
                    <th className="px-4 py-3 text-right font-semibold">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const expandable = r.absent + r.late > 0
                    const notTaken = r.roll > 0 && r.notMarked === r.roll
                    return (
                      <Fragment key={r.c.id}>
                        <tr onClick={() => expandable && setOpen(open === r.c.id ? null : r.c.id)} className={`border-t border-gray-100 ${expandable ? 'cursor-pointer hover:bg-royal-50/60' : ''}`}>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5 font-medium text-royal-900">
                              {expandable ? open === r.c.id ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" /> : <span className="w-4" />}
                              {r.c.name}
                            </span>
                            <span className="ml-5.5 block pl-[22px] text-xs text-gray-400">{teacherName(r.c.teacher_id)}</span>
                          </td>
                          <td className="px-2 py-2.5 text-right text-gray-600">{r.roll}</td>
                          {notTaken ? (
                            <td colSpan={5} className="px-2 py-2.5 text-center"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Register not taken</span></td>
                          ) : (
                            <>
                              <td className="px-2 py-2.5 text-right font-semibold text-green-600">{r.present}</td>
                              <td className="px-2 py-2.5 text-right font-semibold text-orange-500">{r.late}</td>
                              <td className="px-2 py-2.5 text-right font-semibold text-red-600">{r.absent}</td>
                              <td className="px-2 py-2.5 text-right text-gray-600">{r.boys}</td>
                              <td className="px-2 py-2.5 text-right text-gray-600">{r.girls}</td>
                            </>
                          )}
                          <td className="px-4 py-2.5 text-right font-semibold text-royal-900">{notTaken ? '-' : `${pct(r)}%`}</td>
                        </tr>
                        {open === r.c.id && (
                          <tr className="bg-gray-50">
                            <td colSpan={8} className="px-4 py-3 text-xs">
                              {r.absentNames.length > 0 && (
                                <p className="mb-1"><b className="text-red-600">Absent:</b> {r.absentNames.join(', ')}</p>
                              )}
                              {r.lateNames.length > 0 && (
                                <p><b className="text-orange-500">Late:</b> {r.lateNames.join(', ')}</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                    <td className="px-4 py-2.5">Whole school</td>
                    <td className="px-2 py-2.5 text-right">{tot.roll}</td>
                    <td className="px-2 py-2.5 text-right text-green-600">{tot.present}</td>
                    <td className="px-2 py-2.5 text-right text-orange-500">{tot.late}</td>
                    <td className="px-2 py-2.5 text-right text-red-600">{tot.absent}</td>
                    <td className="px-2 py-2.5 text-right">{tot.boys}</td>
                    <td className="px-2 py-2.5 text-right">{tot.girls}</td>
                    <td className="px-4 py-2.5 text-right">{pct(tot)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
