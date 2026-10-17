import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarOff, Loader2, Share2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { localISO, lastWeekday } from '@/lib/attendance'
import { money } from '@/components/fees/fee-utils'
import { classRows, loadDay, staffSummary, type Day } from '@/lib/headteacher'
import { dayTotals, r2, toNum, type Sale, type StoreItem } from '@/lib/store'
import { holidayName, isSchoolDay, useTermDates } from '@/lib/terms'

interface Money {
  fees: number
  feeCount: number
  schoolFees: number
  classFees: number
  feeding: number
  sales: Sale[]
  items: StoreItem[]
  submitted: number | null
  note: string
}

const nextDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return localISO(d)
}

async function loadMoney(date: string): Promise<Money> {
  const [pay, col, feed, items, sales, sub] = await Promise.all([
    supabase.from('fee_payments').select('amount').eq('status', 'valid').neq('source', 'before_system').gte('paid_at', `${date}T00:00:00Z`).lt('paid_at', `${nextDay(date)}T00:00:00Z`),
    supabase.from('daily_collections').select('school_fee_total, class_fee_total').eq('date', date),
    supabase.from('daily_feeding').select('amount').eq('date', date).maybeSingle(),
    supabase.from('store_items').select('id, name, kind, commission_rate, is_active, sort_order'),
    supabase.from('store_sales').select('sale_date, item_id, amount, commission').eq('sale_date', date),
    supabase.from('store_submissions').select('amount_submitted, note').eq('sale_date', date).maybeSingle(),
  ])
  const sum = (rows: { [k: string]: unknown }[] | null, k: string) => (rows ?? []).reduce((a, r) => a + toNum(r[k] as string), 0)
  return {
    fees: sum(pay.data, 'amount'),
    feeCount: pay.data?.length ?? 0,
    schoolFees: sum(col.data, 'school_fee_total'),
    classFees: sum(col.data, 'class_fee_total'),
    feeding: toNum(feed.data?.amount as string),
    items: (items.data ?? []) as StoreItem[],
    sales: ((sales.data ?? []) as Sale[]).map((s) => ({ ...s, amount: toNum(s.amount), commission: toNum(s.commission) })),
    submitted: sub.data ? toNum(sub.data.amount_submitted as string) : null,
    note: (sub.data?.note as string | null) ?? '',
  }
}

/** One screen for the day: attendance, staff, money collected and the store */
export default function HeadteacherSummary() {
  const { holidays } = useTermDates()
  const [date, setDate] = useState(() => lastWeekday())
  const [day, setDay] = useState<Day | null>(null)
  const [mon, setMon] = useState<Money | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setDay(null)
    setMon(null)
    setError('')
    Promise.all([loadDay(date), loadMoney(date)])
      .then(([d, m]) => {
        if (!alive) return
        setDay(d)
        setMon(m)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load the summary'))
    return () => {
      alive = false
    }
  }, [date])

  const ss = useMemo(() => (day ? staffSummary(day, date) : null), [day, date])
  const rows = useMemo(() => (day ? classRows(day) : []), [day])
  const tot = rows.reduce((a, r) => ({ roll: a.roll + r.roll, present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent, notMarked: a.notMarked + r.notMarked }), { roll: 0, present: 0, late: 0, absent: 0, notMarked: 0 })
  const notTaken = rows.filter((r) => r.roll > 0 && r.notMarked === r.roll).map((r) => r.c.name)
  const store = mon ? dayTotals(mon.items, mon.sales) : null
  const diff = store && mon && mon.submitted !== null ? r2(mon.submitted - store.toSubmit) : null
  const registerTaken = tot.present + tot.late + tot.absent
  const schoolDay = isSchoolDay(date, holidays)
  const nice = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const collected = mon ? mon.fees + mon.schoolFees + mon.classFees + mon.feeding : 0

  const text = useMemo(() => {
    if (!ss || !mon || !store) return ''
    return [
      `SAT Royal Basic School - ${nice}`,
      '',
      `Staff: ${ss.present + ss.late + ss.veryLate}/${ss.total} in (${ss.late + ss.veryLate} late, ${ss.absent} absent)`,
      `Students: ${tot.present + tot.late}/${tot.roll} present, ${tot.absent} absent${notTaken.length ? `. Register not taken: ${notTaken.join(', ')}` : ''}`,
      '',
      `Fees paid at the bursar: ${money(mon.fees)} (${mon.feeCount} payments)`,
      `Daily school fees: ${money(mon.schoolFees)}, class fees: ${money(mon.classFees)}, feeding: ${money(mon.feeding)}`,
      '',
      `Store: to submit ${money(store.toSubmit)}${mon.submitted !== null ? `, submitted ${money(mon.submitted)}${diff ? (diff < 0 ? ` (short ${money(-diff)})` : ` (over ${money(diff)})`) : ' (matches)'}` : ', not submitted yet'}`,
    ].join('\n')
  }, [ss, mon, store, tot, notTaken, diff, nice])

  async function share() {
    try {
      if (navigator.share) await navigator.share({ text })
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    } catch {
      /* cancelled */
    }
  }

  const card = 'rounded-2xl bg-white p-4 shadow-sm'
  const big = 'mt-1 text-2xl font-bold'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Daily summary</h1>
          <p className="mt-1 text-sm text-gray-500">{nice}</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} max={localISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          <button onClick={share} disabled={!text} className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-50">
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      </div>

      {!schoolDay && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <CalendarOff className="h-4 w-4 shrink-0" /> Not a school day{holidayName(date, holidays) ? `: ${holidayName(date, holidays)}` : ' (weekend)'}. Figures below may be empty.
        </p>
      )}
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!day || !mon || !ss || !store ? (
        !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <h2 className="mt-6 font-semibold text-royal-900">Attendance</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Staff in</p>
              <p className={`${big} text-green-600`}>{ss.present + ss.late + ss.veryLate}<span className="text-sm font-medium text-gray-400"> / {ss.total}</span></p>
              <p className="text-xs text-gray-400">{ss.late + ss.veryLate} late · {ss.absentNow ? `${ss.absent} absent` : 'check-in open'}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Students present</p>
              <p className={`${big} text-royal-700`}>{registerTaken ? `${Math.round(((tot.present + tot.late) / registerTaken) * 100)}%` : '-'}</p>
              <p className="text-xs text-gray-400">{tot.present + tot.late} of {tot.roll} on roll</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Students absent</p>
              <p className={`${big} text-red-600`}>{tot.absent}</p>
              <p className="text-xs text-gray-400">{tot.late} came late</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Registers</p>
              <p className={`${big} text-royal-900`}>{rows.filter((r) => r.roll > 0).length - notTaken.length}<span className="text-sm font-medium text-gray-400"> / {rows.filter((r) => r.roll > 0).length}</span></p>
              <p className="text-xs text-gray-400">{notTaken.length ? `Not taken: ${notTaken.join(', ')}` : 'All taken'}</p>
            </div>
          </div>
          <Link to="/headteacher/attendance" className="mt-2 inline-block text-xs font-semibold text-royal-600 hover:underline">Full attendance</Link>

          <h2 className="mt-6 font-semibold text-royal-900">Money collected</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Fees at the bursar</p>
              <p className={`${big} text-royal-900`}>{money(mon.fees)}</p>
              <p className="text-xs text-gray-400">{mon.feeCount} payment{mon.feeCount === 1 ? '' : 's'}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Daily school fees</p>
              <p className={`${big} text-royal-900`}>{money(mon.schoolFees)}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Daily class fees</p>
              <p className={`${big} text-royal-900`}>{money(mon.classFees)}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Feeding</p>
              <p className={`${big} text-royal-900`}>{money(mon.feeding)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">Total of the four: <b className="text-royal-900">{money(collected)}</b>. Payments recorded as "before the system" are not counted.</p>

          <h2 className="mt-6 font-semibold text-royal-900">Store</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">School items</p>
              <p className={`${big} text-royal-900`}>{money(store.school)}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Commission</p>
              <p className={`${big} text-royal-900`}>{money(store.commission)}</p>
              <p className="text-xs text-gray-400">on parents' items</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">To submit</p>
              <p className={`${big} text-royal-900`}>{money(store.toSubmit)}</p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-gray-500">Submitted</p>
              <p className={`${big} text-royal-900`}>{mon.submitted === null ? '-' : money(mon.submitted)}</p>
              <p className={`text-xs font-semibold ${diff === null ? 'text-gray-400' : diff === 0 ? 'text-green-600' : 'text-red-600'}`}>
                {diff === null ? 'Not submitted yet' : diff === 0 ? 'Matches' : diff < 0 ? `Short ${money(-diff)}` : `Over ${money(diff)}`}
              </p>
            </div>
          </div>
          {mon.note && <p className="mt-2 text-xs text-gray-500">Store-keeper's note: {mon.note}</p>}
        </>
      )}
    </div>
  )
}