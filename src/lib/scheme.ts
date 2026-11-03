// The scheme of learning: what the government schedule says to teach in each week, per class and subject.

export interface SchemeIndicator {
  code: string
  text: string
}
export interface SchemeItem {
  strand: string
  sub_strand: string
  content_standard: string
  indicators: SchemeIndicator[]
  resources: string
}
export type WeekKind = 'lesson' | 'revision' | 'exam' | 'sba'
export interface SchemeWeek {
  id: string
  academic_year: string
  term: string
  class_name: string
  subject: string
  subject_key: string
  week_no: number
  kind: WeekKind
  topic: string | null
  items: SchemeItem[]
}
export const SCHEME_COLUMNS = 'id, academic_year, term, class_name, subject, subject_key, week_no, kind, topic, items'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** The same subject under any name the school uses (matches subject_key in the scheme data) */
export function subjectKey(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(computing|ict|computer)\b|information (and|&) communication/.test(s)) return 'computing'
  if (/career|ctech|c tech|technology/.test(s)) return 'career technology'
  if (/english/.test(s)) return 'english'
  if (/math/.test(s)) return 'maths'
  if (/relig|\brme\b/.test(s)) return 'rme'
  if (/social/.test(s)) return 'social studies'
  if (/science/.test(s)) return 'science'
  if (/creative|\barts?\b/.test(s)) return 'creative arts'
  if (/ghanaian|dangme|\btwi\b|\bewe\b|\bga\b|fante|akan|nzema|gonja|dagbani|kasem/.test(s)) return 'ghanaian language'
  if (/french/.test(s)) return 'french'
  if (/histor/.test(s)) return 'history'
  return s
}

/* ---------------------------------------------------------------- dates (local time, weeks start on Monday) */

export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function dateOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12) // noon, so daylight saving can never move the day
}
export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

/** The term's calendar week (1, 2, 3 ...) that a date falls in, or null outside the term */
export function calendarWeek(today: Date, termStart: string, termEnd: string): number | null {
  const start = dateOf(termStart)
  const end = dateOf(termEnd)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  if (t < start || t > end) return null
  return Math.round((mondayOf(t).getTime() - mondayOf(start).getTime()) / (7 * 86_400_000)) + 1
}

/** Monday to Friday dates of a calendar week of the term; null before the term starts */
export function weekDates(termStart: string, calWeek: number): Record<Weekday, string> | null {
  if (calWeek < 1) return null
  const monday = addDays(mondayOf(dateOf(termStart)), (calWeek - 1) * 7)
  return Object.fromEntries(WEEKDAYS.map((w, i) => [w, isoOf(addDays(monday, i))])) as Record<Weekday, string>
}

/**
 * Which scheme week the school is on. The private school runs `offset` weeks ahead of the government schedule,
 * so its calendar week 5 teaches scheme week 5 + offset.
 */
export const schemeWeekOf = (calWeek: number, offset: number) => calWeek + offset
export const calendarWeekOf = (schemeWeek: number, offset: number) => schemeWeek - offset

export const shortDay = (iso: string) => dateOf(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
