import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarOff,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Loader2,
  Newspaper,
  Store,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { localISO, staffStatusClass, staffStatusLabel } from '@/lib/attendance'
import { money } from '@/components/fees/fee-utils'
import { addDays, dayTotals, isoOf, monday, r2, toNum, type Sale, type StoreItem } from '@/lib/store'
import { ROLE_LABEL, classRows, isFemale, isMale, loadDay, pctPresent, staffSummary, type Day } from '@/lib/headteacher'
import { holidayName, isSchoolDay, useTermDates } from '@/lib/terms'
import schoolLogo from '@/assets/school-logo.png'

const ROYAL = '#1E3FBF'
const NAVY = '#0F1F63'
const GOLD = '#FFD60A'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Circular progress, 0-100 */
function Ring({ value, size = 64, stroke = 7, color = ROYAL, track = '#E8ECF8', children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-royal-900">{children}</div>
    </div>
  )
}

const tone = (p: number) => (p >= 90 ? '#16a34a' : p >= 75 ? '#E6BE00' : '#dc2626')

export default function HeadteacherDashboard() {
  const { profile } = useAuth()
  const { holidays } = useTermDates()
  const todayIso = localISO()

  // On weekends and holidays show the last school day instead of an empty screen
  const dataDay = useMemo(() => {
    const d = new Date(todayIso + 'T00:00:00')
    for (let i = 0; i < 40 && !isSchoolDay(localISO(d), holidays); i++) d.setDate(d.getDate() - 1)
    return localISO(d)
  }, [todayIso, holidays])
  const isToday = dataDay === todayIso

  const [day, setDay] = useState<Day | null>(null)
  const [fees, setFees] = useState<{ day: number; week: number } | null>(null)
  const [store, setStore] = useState<{ toSubmit: number; submitted: number | null } | null>(null)

  useEffect(() => {
    let alive = true
    setDay(null)
    setFees(null)
    setStore(null)
    loadDay(dataDay).then((d) => alive && setDay(d))

    const weekStart = isoOf(monday(new Date(dataDay + 'T00:00:00')))
    const end = isoOf(addDays(new Date(dataDay + 'T00:00:00'), 1))
    supabase
      .from('fee_payments')
      .select('amount, paid_at')
      .eq('status', 'valid')
      .neq('source', 'before_system')
      .gte('paid_at', `${weekStart}T00:00:00Z`)
      .lt('paid_at', `${end}T00:00:00Z`)
      .then(({ data }) => {
        if (!alive) return
        const rows = data ?? []
        const sum = (list: { amount: number | string }[]) => list.reduce((a, r) => a + Number(r.amount), 0)
        setFees({ day: sum(rows.filter((r) => String(r.paid_at).slice(0, 10) === dataDay)), week: sum(rows) })
      })

    Promise.all([
      supabase.from('store_items').select('id, name, kind, commission_rate, is_active, sort_order'),
      supabase.from('store_sales').select('sale_date, item_id, amount, commission').eq('sale_date', dataDay),
      supabase.from('store_submissions').select('amount_submitted').eq('sale_date', dataDay).maybeSingle(),
    ]).then(([it, sa, su]) => {
      if (!alive) return
      const sales = ((sa.data ?? []) as Sale[]).map((s) => ({ ...s, amount: toNum(s.amount), commission: toNum(s.commission) }))
      const t = dayTotals((it.data ?? []) as StoreItem[], sales)
      setStore({ toSubmit: t.toSubmit, submitted: su.data ? toNum(su.data.amount_submitted as string) : null })
    })
    return () => {
      alive = false
    }
  }, [dataDay])

  const ss = useMemo(() => (day ? staffSummary(day, dataDay) : null), [day, dataDay])
  const rows = useMemo(() => (day ? classRows(day) : []), [day])
  const tot = rows.reduce((a, r) => ({ roll: a.roll + r.roll, present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent }), { roll: 0, present: 0, late: 0, absent: 0 })
  const boys = day?.students.filter((s) => isMale(s.gender)).length ?? 0
  const girls = day?.students.filter((s) => isFemale(s.gender)).length ?? 0
  const registerTaken = tot.present + tot.late + tot.absent
  const studentPct = registerTaken ? Math.round(((tot.present + tot.late) / registerTaken) * 100) : 0
  const notTaken = rows.filter((r) => r.roll > 0 && r.notMarked === r.roll)
  const staffIn = ss ? ss.present + ss.late + ss.veryLate : 0
  const staffPct = ss && ss.total ? Math.round((staffIn / ss.total) * 100) : 0
  const attention = day && ss ? day.staff.map((s) => ({ s, r: ss.recOf.get(s.id) })).filter(({ r }) => (r ? r.status === 'Late' || r.status === 'Very Late' : ss.absentNow)) : []
  const first = (profile?.full_name || '').split(' ')[0]
  const diff = store && store.submitted !== null ? r2(store.submitted - store.toSubmit) : null
  const niceDay = (iso: string, long = false) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' })

  const card = 'rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(15,31,99,0.06),0_8px_24px_-12px_rgba(15,31,99,0.18)] ring-1 ring-royal-100/70'
  const links = [
    { to: '/headteacher/summary', label: 'Daily Summary', icon: Newspaper },
    { to: '/headteacher/alerts', label: 'Send an alert', icon: BellRing },
    { to: '/headteacher/attendance', label: 'Attendance', icon: ClipboardCheck },
    { to: '/headteacher/staff-report', label: 'Staff Report', icon: UserCheck },
    { to: '/headteacher/results', label: 'Results', icon: BarChart3 },
    { to: '/headteacher/performance', label: 'Performance', icon: TrendingUp },
    { to: '/headteacher/report-cards', label: 'Report Cards', icon: FileText },
    { to: '/headteacher/students', label: 'Students', icon: GraduationCap },
    { to: '/headteacher/fees', label: 'Fees', icon: Wallet },
    { to: '/headteacher/store', label: 'Store', icon: Store },
  ]

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero: royal blue with gold */}
      <section className="relative overflow-hidden rounded-3xl p-6 text-white shadow-lg sm:p-8" style={{ background: `linear-gradient(120deg, ${ROYAL} 0%, #1832A0 45%, ${NAVY} 100%)` }}>
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ background: GOLD }} />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: '#3557E0' }} />
        <img src={schoolLogo} alt="" className="pointer-events-none absolute -right-6 top-1/2 hidden h-64 w-64 -translate-y-1/2 object-contain opacity-[0.07] sm:block" />
        <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: `linear-gradient(90deg, ${GOLD}, #E6BE00 60%, transparent)` }} />

        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-royal-900" style={{ background: GOLD }}>
              {niceDay(todayIso, true)}
            </span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {greeting()}
              {first ? `, ${first}` : ''}
            </h1>
            <p className="mt-1 text-sm text-blue-100">{isToday ? 'Here is how the school is doing today.' : `Showing the last school day, ${niceDay(dataDay)}.`}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              ['Staff in', day ? `${staffIn}/${ss!.total}` : '…'],
              ['Students', day ? (registerTaken ? `${studentPct}%` : '–') : '…'],
              ['Fees', fees ? money(fees.day) : '…'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white/10 px-3 py-2.5 text-center ring-1 ring-white/20 backdrop-blur sm:px-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-blue-100">{k}</p>
                <p className="mt-0.5 text-lg font-extrabold sm:text-xl" style={{ color: GOLD }}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {!isToday && (
        <p className="mt-4 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
          <CalendarOff className="h-4 w-4 shrink-0" />
          {holidayName(todayIso, holidays) ? `Today is a holiday (${holidayName(todayIso, holidays)}).` : 'There is no school today.'} The figures below are for {niceDay(dataDay)}.
        </p>
      )}

      {!day || !ss ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          {/* KPIs */}
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className={card}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500">Staff in</p>
                <Ring value={staffPct} size={44} stroke={5} color="#16a34a"><span className="text-[10px]">{staffPct}%</span></Ring>
              </div>
              <p className="mt-2 text-3xl font-extrabold text-royal-900">{staffIn}<span className="text-base font-semibold text-gray-400"> / {ss.total}</span></p>
              <p className="mt-1 text-xs text-gray-500">{ss.late + ss.veryLate} late · {ss.absentNow ? `${ss.absent} absent` : 'check-in open'}</p>
            </div>
            <div className={card}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500">Students present</p>
                <Ring value={studentPct} size={44} stroke={5} color={registerTaken ? tone(studentPct) : '#cbd5e1'}><span className="text-[10px]">{registerTaken ? `${studentPct}%` : '–'}</span></Ring>
              </div>
              <p className="mt-2 text-3xl font-extrabold text-royal-900">{tot.present + tot.late}<span className="text-base font-semibold text-gray-400"> / {tot.roll}</span></p>
              <p className="mt-1 text-xs text-gray-500">{tot.absent} absent · {tot.late} late</p>
            </div>
            <div className={card}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500">Fees collected</p>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-royal-900" style={{ background: GOLD }}><Wallet className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 text-3xl font-extrabold text-royal-900">{fees ? money(fees.day) : '…'}</p>
              <p className="mt-1 text-xs text-gray-500">{fees ? `${money(fees.week)} this week` : ''}</p>
            </div>
            <div className={card}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500">Students on roll</p>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-royal-50 text-royal-600"><Users className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 text-3xl font-extrabold text-royal-900">{day.students.length}</p>
              <p className="mt-1 text-xs text-gray-500">{boys} boys · {girls} girls</p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {/* Attendance by class */}
            <section className={`${card} lg:col-span-2`}>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-royal-900">Attendance by class</h2>
                <Link to="/headteacher/attendance" className="flex items-center gap-1 text-xs font-semibold text-royal-600 hover:underline">
                  Details <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {notTaken.length > 0 && (
                <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
                  Register not taken: <b>{notTaken.map((r) => r.c.name).join(', ')}</b>
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rows
                  .filter((r) => r.roll > 0)
                  .map((r) => {
                    const taken = r.notMarked !== r.roll
                    const p = pctPresent(r)
                    return (
                      <div key={r.c.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                        <Ring value={taken ? p : 0} size={46} stroke={5} color={tone(p)}>
                          <span className="text-[10px]">{taken ? `${p}%` : '–'}</span>
                        </Ring>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-royal-900">{r.c.name}</p>
                          <p className="truncate text-[11px] text-gray-500">{taken ? `${r.present + r.late}/${r.roll} in${r.absent ? ` · ${r.absent} out` : ''}` : 'not taken'}</p>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </section>

            <div className="space-y-5">
              {/* Money */}
              <section className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg" style={{ background: `linear-gradient(140deg, ${NAVY}, ${ROYAL})` }}>
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: GOLD }} />
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold">Store</h2>
                  <Link to="/headteacher/summary" className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: GOLD }}>
                    Full summary <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {store ? (
                  <>
                    <p className="mt-3 text-xs text-blue-100">To submit</p>
                    <p className="text-2xl font-extrabold" style={{ color: GOLD }}>{money(store.toSubmit)}</p>
                    <p className="mt-2 text-xs text-blue-100">
                      {store.submitted === null ? 'Not submitted yet' : `Submitted ${money(store.submitted)}`}
                      {diff !== null && <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${diff === 0 ? 'bg-green-400/20 text-green-200' : 'bg-red-400/20 text-red-200'}`}>{diff === 0 ? 'Matches' : diff < 0 ? `Short ${money(-diff)}` : `Over ${money(diff)}`}</span>}
                    </p>
                  </>
                ) : (
                  <Loader2 className="mt-4 h-5 w-5 animate-spin" />
                )}
              </section>

              {/* Staff to follow up */}
              <section className={card}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-royal-900">Staff to follow up</h2>
                  <Link to="/headteacher/attendance" className="flex items-center gap-1 text-xs font-semibold text-royal-600 hover:underline">
                    All staff <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {attention.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">{ss.absentNow ? 'Everyone is in.' : 'Nobody late so far.'}</p>
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
          </div>

          {/* Quick links */}
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {links.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="group flex flex-col items-center gap-2 rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-royal-100/70 transition hover:-translate-y-0.5 hover:shadow-md">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-royal-50 text-royal-600 transition group-hover:text-royal-900">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] font-semibold leading-tight text-royal-900">{label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}