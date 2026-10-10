import { localISO } from '@/lib/attendance'

export type ItemKind = 'school' | 'parent'
export interface StoreItem {
  id: string
  name: string
  kind: ItemKind
  commission_rate: number | null
  is_active: boolean
  sort_order: number
}
export interface Sale {
  sale_date: string
  item_id: string
  amount: number
  commission: number
}
export interface Submission {
  sale_date: string
  amount_submitted: number
  note: string | null
}

export const KIND_LABEL: Record<ItemKind, string> = { school: "School's own items", parent: "Parents' items (sold for parents)" }

export const toNum = (v: string | number | null | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export const r2 = (n: number) => Math.round(n * 100) / 100

export const monday = (d: Date) => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export const isoOf = localISO
export const dayLabel = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** What goes to the school for a day: school items in full + the commission on parents' items */
export function dayTotals(items: StoreItem[], sales: Sale[]) {
  const kind = new Map(items.map((i) => [i.id, i.kind]))
  let school = 0
  let parentSales = 0
  let commission = 0
  for (const s of sales) {
    if (kind.get(s.item_id) === 'parent') {
      parentSales += s.amount
      commission += s.commission
    } else school += s.amount
  }
  return {
    school: r2(school),
    parentSales: r2(parentSales),
    commission: r2(commission),
    parentsShare: r2(parentSales - commission),
    toSubmit: r2(school + commission),
  }
}
