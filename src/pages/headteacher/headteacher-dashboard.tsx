import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, BellRing, ClipboardCheck, FileText, GraduationCap, Loader2, Store, UserCheck, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { localISO, staffStatusClass, staffStatusLabel } from '@/lib/attendance'
import { money } from '@/components/fees/fee-utils'
import { addDays, isoOf, monday } from '@/lib/store'
import { ROLE_LABEL, classRows, isFemale, isMale, loadDay, pctPresent, staffSummary, type Day } from '@/lib/headteacher'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function HeadteacherDashboard() {
  const { profile } = useAuth()
  const today = localISO()
  const [day, setDay] = useState<Day | null>(null)
  const [fees, setFees] = useState<{ today: number; week: number } | null>(null)

  useEffect(() => {
    let alive = true
    loadDay(today).then((d) => alive && setDay(d))
    const weekStart = isoOf(monday(new Date()))
    supabase
      .from('fee_payments')
      .select('amount, paid_at')
      .eq('status', 'valid')
      .gte('paid_at', `${isoOf(addDays(monday(new Date()), 0))}T00:00:00Z`)
      .then(({ data }) => {
        if (!alive) return
        const rows = data ?? []
        const sum = (list: { amount: number | string }[]) => list.reduce((a, r) => a + Number(r.amount), 0)
        setFees({
          today: sum(rows.filter((r) => String(r.paid_at).slice(0, 10) === today)),
          week: sum(rows.filter((r) => String(r.paid_at).slice(0, 10) >= weekStart)),
        })
      })
    return () => {
      alive = false
    }
  }, [today])

  const ss = useMemo(() => (day ? staffSummary(day, today) : null), [day, today])
  const rows = useMemo(() => (day ? classRows(day) : []), [day])
  const tot = rows.reduce((a, r) => ({ roll: a.roll + r.roll, present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent }), { roll: 0, present: 0, late: 0, absent: 0 })
  const boys = day?.students.filter((s) => isMale(s.gender)).length ?? 0
  const girls = day?.students.filter((s) => isFemale(s.gender)).length ?? 0
  const registerTaken = tot.present + tot.late + tot.absent
  const notTaken = rows.filter((r) => r.roll > 0 && r.notMarked === r.roll)
  const attention = day && ss ? day.staff.map((s) => ({ s, r: ss.recOf.get(s.id) })).filter(({ r }) => (r ? r.status === 'Late' || r.status === 'Very Late' : ss.absentNow)) : []
  const first = (profile?.full_name || '').split(' ')[0]

  const card = 'rounded-2xl bg-white p-4 shadow-sm'
  const links = [
    { to: '/headteacher/alerts', label: 'Send an alert', hint: 'Dashboard, phone and SMS', icon: BellRing },
    { to: '/headteacher/attendance', label: 'Attendance', hint: 'Staff and student registers', icon: ClipboardCheck },
    { to: '/headteacher/staff-report', label: 'Staff Report', hint: 'Week, month or term', icon: UserCheck },
    { to: '/headteacher/results', label: 'Results', hint: 'Class averages, top students', icon: BarChart3 },
    { to: '/headteacher/report-cards', label: 'Report Cards', hint: 'Print for a class', icon: FileText },
    { to: '/headteacher/students', label: 'Students', hint: 'Enrolment and contacts', icon: GraduationCap },
    { to: '/headteacher/fees', label: 'Fees', hint: 'Collection by class', icon: Wallet },
    { to: '/headteacher/store', label: 'Store', hint: 'Weekly sales summary', icon: Store },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-2xl bg-gradient-to-r from-royal-800 to-royal-600 p-5 text-white shadow-sm">
        <p className="text-sm text-white/70">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1 className="mt-1 text-2xl font-bold">
          {greeting()}
          {first ? `, ${first}` : ''}
        </h1>
        <p className="mt-1 text-sm text-white/80">Here is how the school is doing today.</p>
      </div>

      {!day ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Staff in today</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {ss!.present + ss!.late + ss!.veryLate}
                <span className="text-sm font-medium text-gray-400"> / {ss!.total}</span>
              </p>
              <p className="text-xs text-gray-400">
                {ss!.late + ss!.veryLate} late · {ss!.absentNow ? `${ss!.absent} absent` : 'check-in open'}
              </p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Students present</p>
              <p className="mt-1 text-2xl font-bold text-royal-700">{registerTaken ? `${Math.round(((tot.present + tot.late) / registerTaken) * 100)}%` : '-'}</p>
              <p className="text-xs text-gray-400">
                {tot.present + tot.late} present · {tot.absent} absent
              </p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Fees collected today</p>
              <p className="mt-1 text-2xl font-bold text-royal-900">{fees ? money(fees.today) : '...'}</p>
              <p className="text-xs text-gray-400">{fees ? `${money(fees.week)} this week` : ''}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Students on roll</p>
              <p className="mt-1 text-2xl font-bold text-royal-900">{day.students.length}</p>
              <p className="text-xs text-gray-400">
                {boys} boys · {girls} girls
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <section className={`${card} lg:col-span-3`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-royal-900">Attendance by class</h2>
                <Link to="/headteacher/attendance" className="text-xs font-semibold text-royal-600 hover:underline">
                  Details
                </Link>
              </div>
              {notTaken.length > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Register not taken yet: <b>{notTaken.map((r) => r.c.name).join(', ')}</b>
                </p>
              )}
              <ul className="mt-3 space-y-2.5">
                {rows
                  .filter((r) => r.roll > 0)
                  .map((r) => {
                    const taken = r.notMarked !== r.roll
                    const p = pctPresent(r)
                    return (
                      <li key={r.c.id}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-royal-900">{r.c.name}</span>
                          <span className="text-xs text-gray-500">
                            {taken ? `${r.present + r.late}/${r.roll} present${r.absent ? ` · ${r.absent} absent` : ''}` : 'not taken'}
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className={`h-full rounded-full ${p >= 90 ? 'bg-green-500' : p >= 75 ? 'bg-gold-400' : 'bg-red-500'}`} style={{ width: taken ? `${p}%` : '0%' }} />
                        </div>
                      </li>
                    )
                  })}
              </ul>
            </section>

            <section className={`${card} lg:col-span-2`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-royal-900">Staff to follow up</h2>
                <Link to="/headteacher/attendance" className="text-xs font-semibold text-royal-600 hover:underline">
                  All staff
                </Link>
              </div>
              {attention.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{ss!.absentNow ? 'Everyone is in.' : 'Nobody late so far.'}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {attention.map(({ s, r }) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium text-royal-900">{s.full_name || s.email}</span>
                        <span className="text-xs text-gray-400">{ROLE_LABEL[s.role] ?? s.role}</span>
                      </span>
                      {r ? (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${staffStatusClass(r.status)}`}>{staffStatusLabel(r.status)}</span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-[11px] font-semibold text-white">Absent</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {links.map(({ to, label, hint, icon: Icon }) => (
              <Link key={to} to={to} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-transparent transition hover:ring-royal-300">
                <Icon className="h-6 w-6 text-royal-700" />
                <p className="mt-2 text-sm font-semibold text-royal-900">{label}</p>
                <p className="text-xs text-gray-500">{hint}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
