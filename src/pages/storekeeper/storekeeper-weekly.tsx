import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { money } from '@/components/fees/fee-utils'
import { addDays, dayLabel, dayTotals, isoOf, monday, r2, toNum, type Sale, type StoreItem, type Submission } from '@/lib/store'

const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })

/** Weekly summary: what sold best, day by day, and what was submitted. Read-only, so admin can use it too. */
export default function StorekeeperWeekly() {
  const [start, setStart] = useState(() => monday(new Date()))
  const [items, setItems] = useState<StoreItem[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [prev, setPrev] = useState<Sale[]>([])
  const [subs, setSubs] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => isoOf(addDays(start, i))), [start])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const from = isoOf(addDays(start, -7))
    const to = isoOf(addDays(start, 6))
    Promise.all([
      supabase.from('store_items').select('id, name, kind, commission_rate, is_active, sort_order').order('sort_order').order('name'),
      supabase.from('store_sales').select('sale_date, item_id, amount, commission').gte('sale_date', from).lte('sale_date', to),
      supabase.from('store_submissions').select('sale_date, amount_submitted, note').gte('sale_date', isoOf(start)).lte('sale_date', to),
    ]).then(([it, sa, su]) => {
      if (!alive) return
      const all = ((sa.data ?? []) as Sale[]).map((s) => ({ ...s, amount: toNum(s.amount), commission: toNum(s.commission) }))
      const mon = isoOf(start)
      setItems((it.data ?? []) as StoreItem[])
      setSales(all.filter((s) => s.sale_date >= mon))
      setPrev(all.filter((s) => s.sale_date < mon))
      setSubs(((su.data ?? []) as Submission[]).map((s) => ({ ...s, amount_submitted: toNum(s.amount_submitted) })))
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [start])

  const rows = useMemo(() => {
    const by = (list: Sale[]) => {
      const m = new Map<string, number>()
      for (const s of list) m.set(s.item_id, (m.get(s.item_id) ?? 0) + s.amount)
      return m
    }
    const cur = by(sales)
    const last = by(prev)
    return items
      .map((i) => {
        const total = r2(cur.get(i.id) ?? 0)
        const before = r2(last.get(i.id) ?? 0)
        return { item: i, total, before, change: before > 0 ? ((total - before) / before) * 100 : null }
      })
      .filter((r) => r.total > 0 || r.before > 0 || r.item.is_active)
  }, [items, sales, prev])

  const ranked = [...rows].filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
  const top = ranked[0]?.total ?? 0
  const week = dayTotals(items, sales)
  const perDay = days.map((d) => ({ d, ...dayTotals(items, sales.filter((s) => s.sale_date === d)), submitted: subs.find((s) => s.sale_date === d) }))
  const cell = (item: StoreItem, d: string) => sales.find((s) => s.item_id === item.id && s.sale_date === d)?.amount

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-royal-900">Weekly summary</h1>
      <p className="mt-1 text-sm text-gray-500">See what students buy the most, so you can plan next week.</p>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm">
        <button onClick={() => setStart(addDays(start, -7))} aria-label="Previous week" className="rounded-lg p-2 text-royal-700 hover:bg-royal-50"><ChevronLeft className="h-5 w-5" /></button>
        <p className="text-sm font-semibold text-royal-900">{dayLabel(days[0])} - {dayLabel(days[4])}</p>
        <button onClick={() => setStart(addDays(start, 7))} disabled={isoOf(addDays(start, 7)) > isoOf()} aria-label="Next week" className="rounded-lg p-2 text-royal-700 hover:bg-royal-50 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {loading ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Sales this week', money(week.school + week.parentSales)],
              ['School items', money(week.school)],
              ["Commission earned", money(week.commission)],
              ["Parents' share", money(week.parentsShare)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className="mt-1 text-lg font-bold text-royal-900">{v}</p>
              </div>
            ))}
          </div>

          <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-royal-900">Students' favourites</h2>
            {ranked.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No sales recorded this week.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {ranked.map((r, i) => (
                  <li key={r.item.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-royal-900">{i + 1}. {r.item.name}{r.item.kind === 'parent' && <span className="ml-1.5 text-xs font-normal text-gray-400">parents'</span>}</span>
                      <span className="flex items-center gap-2">
                        {r.change !== null && (
                          <span className={`flex items-center gap-0.5 text-xs font-semibold ${r.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {r.change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{Math.abs(Math.round(r.change))}%
                          </span>
                        )}
                        <span className="font-semibold">{money(r.total)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${i === 0 ? 'bg-gold-400' : 'bg-royal-500'}`} style={{ width: `${top ? (r.total / top) * 100 : 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-400">The arrow compares with the week before.</p>
          </section>

          <section className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  {days.map((d) => <th key={d} className="px-2 py-3 text-right font-semibold">{day(d)}</th>)}
                  <th className="px-4 py-3 text-right font-semibold">Week</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item.id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-medium text-royal-900">{r.item.name}</td>
                    {days.map((d) => <td key={d} className="px-2 py-2.5 text-right text-gray-600">{cell(r.item, d)?.toFixed(2) ?? '-'}</td>)}
                    <td className="px-4 py-2.5 text-right font-semibold">{r.total.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5">Commission</td>
                  {perDay.map((p) => <td key={p.d} className="px-2 py-2.5 text-right">{p.commission ? p.commission.toFixed(2) : '-'}</td>)}
                  <td className="px-4 py-2.5 text-right">{week.commission.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <h2 className="px-4 pt-4 font-semibold text-royal-900">Money submitted</h2>
            <table className="mt-2 w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2">Day</th><th className="px-2 py-2 text-right">Should submit</th><th className="px-2 py-2 text-right">Submitted</th><th className="px-4 py-2 text-right">Difference</th></tr>
              </thead>
              <tbody>
                {perDay.map((p) => {
                  const diff = p.submitted ? r2(p.submitted.amount_submitted - p.toSubmit) : null
                  return (
                    <tr key={p.d} className="border-t border-gray-100">
                      <td className="px-4 py-2.5">{dayLabel(p.d)}</td>
                      <td className="px-2 py-2.5 text-right">{p.toSubmit ? p.toSubmit.toFixed(2) : '-'}</td>
                      <td className="px-2 py-2.5 text-right">{p.submitted ? p.submitted.amount_submitted.toFixed(2) : '-'}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${diff === null ? 'text-gray-300' : diff === 0 ? 'text-green-600' : 'text-red-600'}`}>{diff === null ? '-' : diff === 0 ? 'OK' : diff.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
