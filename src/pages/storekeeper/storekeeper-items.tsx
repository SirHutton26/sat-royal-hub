import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, Pencil, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { KIND_LABEL, toNum, type ItemKind, type StoreItem } from '@/lib/store'

const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function StorekeeperItems() {
  const [items, setItems] = useState<StoreItem[] | null>(null)
  const [edit, setEdit] = useState<null | Partial<StoreItem>>(null)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('store_items').select('id, name, kind, commission_rate, is_active, sort_order').order('sort_order').order('name')
    setItems((data ?? []) as StoreItem[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  function open(item: Partial<StoreItem>) {
    setEdit(item)
    setRate(item.commission_rate ? String(item.commission_rate) : '')
    setErr('')
  }

  async function save() {
    if (!edit) return
    const name = (edit.name ?? '').trim()
    if (!name) return setErr('Enter the item name')
    const kind: ItemKind = edit.kind ?? 'school'
    if (rate !== '' && (toNum(rate) < 0 || toNum(rate) > 100)) return setErr('Commission must be between 0 and 100')
    setBusy(true)
    const payload = { name, kind, commission_rate: kind === 'parent' && rate !== '' ? toNum(rate) : null, is_active: edit.is_active ?? true }
    const { error } = edit.id
      ? await supabase.from('store_items').update(payload).eq('id', edit.id)
      : await supabase.from('store_items').insert({ ...payload, sort_order: (items?.length ?? 0) + 1 })
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'There is already an item with that name' : error.message)
    setEdit(null)
    await load()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Items</h1>
          <p className="mt-1 text-sm text-gray-500">What you sell. Parents' items give the school a commission.</p>
        </div>
        <button onClick={() => open({ kind: 'school', is_active: true })} className="flex items-center gap-1.5 rounded-lg bg-royal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-royal-700">
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>

      {!items ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : (
        (['school', 'parent'] as ItemKind[]).map((k) => (
          <section key={k} className="mt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{KIND_LABEL[k]}</h2>
            <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-2xl bg-white shadow-sm">
              {items.filter((i) => i.kind === k).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`min-w-0 flex-1 truncate font-medium ${i.is_active ? 'text-royal-900' : 'text-gray-400 line-through'}`}>{i.name}</span>
                  {k === 'parent' && <span className="text-xs text-gray-500">{i.commission_rate ? `${i.commission_rate}% commission` : 'type commission each day'}</span>}
                  {!i.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Hidden</span>}
                  <button onClick={() => open(i)} aria-label={`Edit ${i.name}`} className="rounded-md p-2 text-royal-600 hover:bg-royal-50"><Pencil className="h-4 w-4" /></button>
                </li>
              ))}
              {items.filter((i) => i.kind === k).length === 0 && <li className="px-4 py-4 text-sm text-gray-500">None yet.</li>}
            </ul>
          </section>
        ))
      )}

      {edit && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-royal-900/40 p-4 sm:items-center">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={() => setEdit(null)} aria-label="Close" className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            <h2 className="text-lg font-semibold text-royal-900">{edit.id ? 'Edit item' : 'Add item'}</h2>
            <label className="mt-4 block text-sm font-medium text-royal-900">Name
              <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} autoFocus />
            </label>
            <p className="mt-4 text-sm font-medium text-royal-900">Whose item is it?</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(['school', 'parent'] as ItemKind[]).map((k) => (
                <button key={k} type="button" onClick={() => setEdit({ ...edit, kind: k })} className={`rounded-xl border px-3 py-2 text-left text-sm ${edit.kind === k ? 'border-royal-700 bg-royal-700 text-white' : 'border-gray-200 hover:bg-gray-50'}`}>
                  {k === 'school' ? "School's own" : "A parent's"}
                </button>
              ))}
            </div>
            {edit.kind === 'parent' && (
              <label className="mt-4 block text-sm font-medium text-royal-900">Usual commission % <span className="font-normal text-gray-400">(optional)</span>
                <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 10" className={inputCls} />
                <span className="mt-1 block text-xs font-normal text-gray-500">Fills the commission for you each day. You can still change it.</span>
              </label>
            )}
            {edit.id && (
              <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} className="h-4 w-4 accent-royal-600" />
                Still selling this item
              </label>
            )}
            {err && <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
