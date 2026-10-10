import { supabase } from '@/lib/supabase'

export interface CardSubject {
  subject: string
  classScore: number | null
  examScore: number | null
  total: number | null
  position: number | null
  grade: string | null
  remark: string
}
export interface FeesReminder {
  arrears: number
  tuition: number
  exams: number
  feeding: number
  ict: number
  extra: number
  grandTotal: number
}
export interface Aggregate {
  total: number
  parts: string
}
export interface Card {
  studentId: string
  name: string
  admission: string
  subjects: CardSubject[]
  total: number
  average: number | null
  position: number | null
  aggregate: Aggregate | null
  fees: FeesReminder | null
}
export interface ClassOption {
  id: string
  name: string
  level_group: string | null
}
export interface CardSet {
  className: string
  /** Basic 9 uses the 1-9 scale and shows the best-six aggregate; every other class uses A-E and has no aggregate */
  jhs9: boolean
  rollCount: number
  cards: Card[]
  subjects: string[]
  missingSubjects: string[]
}

export const TERMS = ['Term 1', 'Term 2', 'Term 3']

// KG - Basic 8 (and Basic 7/8): A-E
const AE: { min: number; grade: string; remark: string }[] = [
  { min: 80, grade: 'A', remark: 'Highly Proficient (HP)' },
  { min: 68, grade: 'B', remark: 'Proficient (P)' },
  { min: 54, grade: 'C', remark: 'Approaching Proficiency (AP)' },
  { min: 40, grade: 'D', remark: 'Developing (D)' },
  { min: 0, grade: 'E', remark: 'Emerging (E)' },
]
// Basic 9 only: grades 1-9
const JHS9: { min: number; grade: string; remark: string }[] = [
  { min: 90, grade: '1', remark: 'Excellent' },
  { min: 80, grade: '2', remark: 'Very Good' },
  { min: 70, grade: '3', remark: 'Good' },
  { min: 60, grade: '4', remark: 'High Average' },
  { min: 55, grade: '5', remark: 'Average' },
  { min: 50, grade: '6', remark: 'Low Average' },
  { min: 40, grade: '7', remark: 'Low' },
  { min: 35, grade: '8', remark: 'Lower' },
  { min: 0, grade: '9', remark: 'Lowest' },
]
export const isBasic9 = (className: string) => /(basic|class|b)\s*-?\s*9\b/i.test(className)
const gradeOf = (total: number, jhs9: boolean) => (jhs9 ? JHS9 : AE).find((g) => total >= g.min) ?? (jhs9 ? JHS9 : AE)[(jhs9 ? JHS9 : AE).length - 1]

// The four core subjects counted in the Basic 9 aggregate
const CORE = [/english/i, /math/i, /int(egrated)?\.?\s*sci/i, /social/i]

// Order used on the school's printed report card
const ORDER = [/english/i, /math/i, /int.*sci|integrated/i, /social/i, /r\.?m\.?e|religious/i, /comput|ict/i, /b\.?d\.?t|design/i, /ghana/i, /french/i, /creative/i, /natural/i, /environ/i, /o\.?w\.?o\.?p|our world/i, /literacy/i, /history/i, /writing/i]
const rank = (n: string) => {
  const i = ORDER.findIndex((re) => re.test(n))
  return i === -1 ? 99 : i
}

function nextPeriod(term: string, year: string) {
  const t = TERMS.indexOf(term)
  if (t >= 0 && t < 2) return { term: TERMS[t + 1], year }
  const [a, b] = year.split('/').map(Number)
  return { term: TERMS[0], year: a && b ? `${a + 1}/${b + 1}` : year }
}

const feeKind = (item: string): keyof Omit<FeesReminder, 'arrears' | 'grandTotal'> => {
  const s = item.toLowerCase()
  if (/exam/.test(s)) return 'exams'
  if (/feed/.test(s)) return 'feeding'
  if (/ict|comput/.test(s)) return 'ict'
  if (/extra/.test(s)) return 'extra'
  return 'tuition'
}

export async function loadCardSet(cls: ClassOption, term: string, year: string, withFees: boolean): Promise<CardSet> {
  const [studentsRes, resultsRes, subjectsRes] = await Promise.all([
    supabase.from('students').select('id, full_name, admission_number').eq('class_id', cls.id).eq('is_active', true).order('full_name'),
    supabase
      .from('sba_results')
      .select('student_id, subject, component_a, component_b, exam_score, total_score, grade, position')
      .eq('class_id', cls.id)
      .eq('term', term),
    cls.level_group ? supabase.from('subjects').select('name').eq('level_group', cls.level_group) : Promise.resolve({ data: [] as { name: string }[] }),
  ])
  const students = studentsRes.data ?? []
  const results = resultsRes.data ?? []

  const jhs9 = isBasic9(cls.name)
  // Only the subjects that belong to this class's level appear on the card
  const levelSubjects = (subjectsRes.data ?? []).map((s) => s.name as string)
  const withResults = new Set(results.map((r) => r.subject as string))
  const subjects = (levelSubjects.length ? levelSubjects : [...withResults]).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const missingSubjects = subjects.filter((n) => !withResults.has(n))

  const bySt = new Map<string, Map<string, (typeof results)[number]>>()
  for (const r of results) {
    const m = bySt.get(r.student_id) ?? new Map()
    m.set(r.subject, r)
    bySt.set(r.student_id, m)
  }

  // Fees reminder: what is still owed up to this term (arrears) + next term's fee items
  const fees = new Map<string, FeesReminder>()
  if (withFees && students.length) {
    const nxt = nextPeriod(term, year)
    const { data: bal } = await supabase
      .from('student_fee_balances')
      .select('student_id, item, academic_year, term, balance')
      .in('student_id', students.map((s) => s.id))
    const upTo = `${year}|${term}`
    for (const s of students) fees.set(s.id, { arrears: 0, tuition: 0, exams: 0, feeding: 0, ict: 0, extra: 0, grandTotal: 0 })
    for (const b of bal ?? []) {
      const f = fees.get(b.student_id)
      if (!f) continue
      const amount = Number(b.balance ?? 0)
      const key = `${b.academic_year}|${b.term}`
      if (key <= upTo) {
        if (amount > 0) f.arrears += amount
      } else if (b.academic_year === nxt.year && b.term === nxt.term) {
        f[feeKind(String(b.item))] += Math.max(amount, 0)
      }
    }
    for (const f of fees.values()) f.grandTotal = f.arrears + f.tuition + f.exams + f.feeding + f.ict + f.extra
  }

  const cards: Card[] = students.map((s) => {
    const mine = bySt.get(s.id)
    const rows: CardSubject[] = subjects.map((sub) => {
      const r = mine?.get(sub)
      const total = r?.total_score != null ? Number(r.total_score) : null
      const g = total !== null ? gradeOf(total, jhs9) : null
      return {
        subject: sub,
        classScore: r?.component_a != null ? Number(r.component_a) : null,
        examScore: r?.component_b != null ? Number(r.component_b) : null,
        total,
        position: r?.position != null ? Number(r.position) : null,
        grade: g?.grade ?? null,
        remark: g?.remark ?? '',
      }
    })
    const scored = rows.filter((x) => x.total !== null)
    const total = scored.reduce((sum, x) => sum + (x.total as number), 0)

    // Basic 9: 4 core subjects + the 2 best of the rest (lowest grade numbers), added together
    let aggregate: Aggregate | null = null
    if (jhs9) {
      const core = CORE.map((re) => scored.find((x) => re.test(x.subject)))
      if (core.every(Boolean)) {
        const coreSet = new Set(core.map((x) => x!.subject))
        const electives = scored
          .filter((x) => !coreSet.has(x.subject))
          .sort((a, b) => Number(a.grade) - Number(b.grade) || (b.total as number) - (a.total as number))
          .slice(0, 2)
        if (electives.length === 2) {
          const six = [...core, ...electives] as CardSubject[]
          const sum = six.reduce((acc, x) => acc + Number(x.grade), 0)
          aggregate = { total: sum, parts: six.map((x) => x.grade).join(' + ') }
        }
      }
    }
    return {
      studentId: s.id,
      name: s.full_name,
      admission: s.admission_number,
      subjects: rows,
      total: Math.round(total * 100) / 100,
      average: scored.length ? Math.round((total / scored.length) * 100) / 100 : null,
      position: null,
      aggregate,
      fees: fees.get(s.id) ?? null,
    }
  })

  // Overall position by total score (ties share a position)
  const ranked = cards.filter((c) => c.average !== null).sort((a, b) => b.total - a.total)
  let last = -1
  let pos = 0
  ranked.forEach((c, i) => {
    if (c.total !== last) {
      pos = i + 1
      last = c.total
    }
    c.position = pos
  })

  return { className: cls.name, jhs9, rollCount: students.length, cards, subjects, missingSubjects }
}
