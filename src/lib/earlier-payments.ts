import Papa from 'papaparse'

export interface ListRow {
  name: string
  cls: string
  amount: string
}
export interface Stu {
  id: string
  full_name: string
  admission_number: string
  class_id: string
}

/** Reads names / class / amount from text pasted out of Excel, or from a CSV file */
export function parseList(text: string): ListRow[] {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true })
  let rows = parsed.data.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean))
  if (!rows.length) return []
  let iName = 0
  let iClass = -1
  let iAmt = -1
  const head = rows[0].map((c) => c.toLowerCase())
  const hasHeader = head.some((c) => /name|student|class|amount|paid/.test(c)) && !head.some((c) => /^[\d.,]+$/.test(c))
  if (hasHeader) {
    const find = (re: RegExp) => head.findIndex((c) => re.test(c))
    iName = Math.max(find(/name|student/), 0)
    iClass = find(/class|level/)
    iAmt = find(/amount|paid|payment|fee/)
    rows = rows.slice(1)
  } else if (rows[0].length >= 3) {
    iClass = 1
    iAmt = 2
  } else {
    iAmt = 1
  }
  return rows
    .map((r) => ({
      name: r[iName] ?? '',
      cls: iClass >= 0 ? r[iClass] ?? '' : '',
      amount: String(Number(String(iAmt >= 0 ? r[iAmt] ?? '' : r[r.length - 1] ?? '').replace(/[^\d.]/g, '')) || ''),
    }))
    .filter((r) => r.name)
}

export const normClass = (s: string) => {
  const t = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = t.match(/^B(\d+)$/)
  return m ? `BASIC${m[1]}` : t
}

const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean)

/** Share of the name that matches, whatever order the names are written in */
export function nameScore(a: string, b: string) {
  const x = tokens(a)
  const y = tokens(b)
  if (!x.length || !y.length) return 0
  const used = new Set<number>()
  let hit = 0
  for (const t of x) {
    const i = y.findIndex((u, k) => !used.has(k) && (u === t || (t.length >= 3 && u.length >= 3 && (u.startsWith(t) || t.startsWith(u)))))
    if (i >= 0) {
      used.add(i)
      hit++
    }
  }
  return hit / Math.max(x.length, y.length)
}

/** The student a list row most likely means, or null when it is not clear enough to decide */
export function matchStudent(row: ListRow, students: Stu[], classIds: Map<string, string>): string | null {
  const cid = row.cls ? classIds.get(normClass(row.cls)) : undefined
  const pool = cid ? students.filter((s) => s.class_id === cid) : students
  const scored = pool.map((s) => ({ id: s.id, score: nameScore(row.name, s.full_name) })).sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]?.score ?? 0
  return best && best.score >= 0.66 && best.score - second >= 0.2 ? best.id : null
}
