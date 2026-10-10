import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/components/fees/fee-utils'
import { KIND_LABEL, dayLabel, dayTotals, isoOf, r2, toNum, type ItemKind, type Sale, type StoreItem, type Submission } from '@/lib/store'

interface Entry {
  amount: string
  commission: string
  manual: boolean // commission typed by hand (don't overwrite with the automatic one)
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-right text-base outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function shiftDay(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

export default function StorekeeperToday() {
  const { profile } = useAuth()
  const [date, setDate] = useState(isoOf())
  const [items, setItems] = useState<StoreItem[]>([])
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [saved, setSaved] = useState<Sale[]>([])
  const [submitted, setSubmitted] = useState('')
  const [note, setNote] = useState('')
  const [hadSubmission, setHadSubmission] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    const [it, sa, su] = await Promise.all([
      supabase.from('store_items').select('id, name, kind, commission_rate, is_active, sort_order').order('sort_order').order('name'),
      supabase.from('store_sales').select('sale_date, item_id, amount, commission').eq('sale_date', date),
      supabase.from('store_submissions').select('sale_date, amount_submitted, note').eq('sale_date', date).maybeSingle(),
    ])
    if (it.error) setMsg({ ok: false, text: it.error.message })
    const list = (it.data ?? []) as StoreItem[]
    const sales = ((sa.data ?? []) as Sale[]).map((s) => ({ ...s, amount: toNum(s.amount), commission: toNum(s.commission) }))
    setItems(list)
    setSaved(sales)
    const e: Record<string, Entry> = {}
    for (const s of sales) e[s.item_id] = { amount: String(s.amount), commission: s.commission ? String(s.commission) : '', manual: true }
    setEntries(e)
    const sub = su.data as Submission | null
    setHadSubmission(!!sub)
    setSubmitted(sub ? String(toNum(sub.amount_submitted)) : '')
    setNote(sub?.note ?? '')
    setLoading(false)
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => items.filter((i) => i.is_active || entries[i.id]), [items, entries])

  function setAmount(item: StoreItem, value: string) {
    setEntries((prev) => {
      const cur = prev[item.id] ?? { amount: '', commission: '', manual: false }
      let commission = cur.commission
      if (item.kind === 'parent' && !cur.manual) {
        commission = value !== '' && item.commission_rate ? String(r2((toNum(value) * item.commission_rate) / 100)) : ''
      }
      return { ...prev, [item.id]: { ...cur, amount: value, commission } }
    })
  }
  const setCommission = (id: string, value: string) =>
    setEntries((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { amount: '', commission: '', manual: true }), commission: value, manual: true } }))

  // live totals from what is typed on screen
  const current: Sale[] = items
    .filter((i) => entries[i.id]?.amount !== undefined && entries[i.id].amount !== '')
    .map((i) => ({ sale_date: date, item_id: i.id, amount: toNum(entries[i.id].amount), commission: i.kind === 'parent' ? toNum(entries[i.id].commission) : 0 }))
  const t = dayTotals(items, current)
  const diff = submitted === '' ? null : r2(toNum(submitted) - t.toSubmit)

  async function save() {
    if (!profile) return
    setMsg(null)
    for (const i of items) {
      const e = entries[i.id]
      if (!e || e.amount === '') continue
      if (toNum(e.amount) < 0) return setMsg({ ok: false, text: `${i.name}: amount cannot be negative` })
      if (i.kind === 'parent' && toNum(e.commission) > toNum(e.amount)) return setMsg({ ok: false, text: `${i.name}: commission cannot be more than the sales` })
    }
    setSaving(true)
    const rows = current.map((c) => ({ ...c, recorded_by: profile.id, updated_at: new Date().toISOString() }))
    const cleared = saved.filter((s) => !current.some((c) => c.item_id === s.item_id)).map((s) => s.item_id)
    let error: { message: string } | null = null
    if (rows.length) ({ error } = await supabase.from('store_sales').upsert(rows, { onConflict: 'sale_date,item_id' }))
    if (!error && cleared.length) ({ error } = await supabase.from('store_sales').delete().eq('sale_date', date).in('item_id', cleared))
    if (!error) {
      if (submitted !== '') {
        ;({ error } = await supabase
          .from('store_submissions')
          .upsert({ sale_date: date, amount_submitted: toNum(submitted), note: note.trim() || null, recorded_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: 'sale_date' }))
      } else if (hadSubmission) {
        ;({ error } = await supabase.from('store_submissions').delete().eq('sale_date', date))
      }
    }
    setSaving(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setSaved(current)
    setHadSubmission(submitted !== '')
    setMsg({ ok: true, text: navigator.onLine ? 'Saved' : "Saved on this phone. It will upload when you're back online." })
  }

  const groups: ItemKind[] = ['school', 'parent']

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="text-2xl font-bold text-royal-900">Daily record</h1>
      <p className="mt-1 text-sm text-gray-500">Type the money made from each item today. Leave an item empty if nothing was sold.</p>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm">
        <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" className="rounded-lg p-2 text-royal-700 hover:bg-royal-50">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <label className="text-center">
          <span className="block text-sm font-semibold text-royal-900">{dayLabel(date)}</span>
          <input type="date" value={date} max={isoOf()} onChange={(e) => e.target.value && setDate(e.target.value)} className="mt-0.5 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600" />
        </label>
        <button onClick={() => setDate(shiftDay(date, 1))} disabled={date >= isoOf()} aria-label="Next day" className="rounded-lg p-2 text-royal-700 hover:bg-royal-50 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        <>
          {groups.map((kind) => {
            const list = shown.filter((i) => i.kind === kind)
            if (!list.length) return null
            return (
              <section key={kind} className="mt-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{KIND_LABEL[kind]}</h2>
                <div className="mt-2 space-y-2">
                  {list.map((i) => {
                    const e = entries[i.id]
                    return (
                      <div key={i.id} className="rounded-2xl bg-white p-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate font-medium text-royal-900">{i.name}</span>
                          <div className="w-36">
                            <input inputMode="decimal" placeholder="0.00" value={e?.amount ?? ''} onChange={(ev) => setAmount(i, ev.target.value.replace(/[^\d.]/g, ''))} className={field} aria-label={`${i.name} amount`} />
                          </div>
                        </div>
                        {kind === 'parent' && (
                          <div className="mt-2 flex items-center gap-3 text-sm">
                            <span className="flex-1 text-gray-500">
                              School commission{i.commission_rate ? ` (${i.commission_rate}%)` : ''}
                            </span>
                            <div className="w-36">
                              <input inputMode="decimal" placeholder="0.00" value={e?.commission ?? ''} onChange={(ev) => setCommission(i.id, ev.target.value.replace(/[^\d.]/g, ''))} className={`${field} py-1.5 text-sm`} aria-label={`${i.name} commission`} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <section className="mt-6 rounded-2xl bg-royal-700 p-4 text-white shadow-sm">
            <div className="flex justify-between text-sm"><span className="text-white/70">School items</span><span>{money(t.school)}</span></div>
            <div className="mt-1 flex justify-between text-sm"><span className="text-white/70">Commission (parents' items)</span><span>{money(t.commission)}</span></div>
            <div className="mt-2 flex justify-between border-t border-white/20 pt-2 text-lg font-bold"><span>To submit</span><span>{money(t.toSubmit)}</span></div>
            {t.parentSales > 0 && (
              <p className="mt-2 text-xs text-white/70">Parents' items sold {money(t.parentSales)}. Parents' share to give back: {money(t.parentsShare)}.</p>
            )}
          </section>

          <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-royal-900">Money submitted</h2>
            <div className="mt-2 flex items-center gap-3">
              <input inputMode="decimal" placeholder="0.00" value={submitted} onChange={(e) => setSubmitted(e.target.value.replace(/[^\d.]/g, ''))} className={field} aria-label="Money submitted" />
              {diff !== null && (
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${diff === 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {diff === 0 ? 'Matches' : diff < 0 ? `Short ${money(-diff)}` : `Over ${money(diff)}`}
                </span>
              )}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </section>

          {msg && (
            <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
            </p>
          )}

          <div className="fixed inset-x-0 bottom-16 z-30 px-4 md:static md:mt-5 md:px-0">
            <button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-400 py-3.5 text-base font-bold text-royal-900 shadow-lg hover:bg-gold-500 disabled:opacity-60 md:shadow-sm">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save today's record
            </button>
          </div>
        </>
      )}
    </div>
  )
}
