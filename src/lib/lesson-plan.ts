// Lesson plans written by the generate-lesson-plan function

export interface Phase {
  name: string
  minutes: number
  teacher_activities: string[]
  learner_activities: string[]
}

export interface Plan {
  title: string
  performance_indicators: string[]
  core_competencies: string[]
  key_words: string[]
  learning_resources: string[]
  previous_knowledge: string
  phases: Phase[]
  assessment: string[]
  homework: string
}

export interface PlanRow {
  id: string
  title: string
  class_name: string
  subject: string
  strand: string | null
  sub_strand: string | null
  content_standard: string | null
  indicators: { code: string; text: string }[]
  duration_minutes: number
  class_size: number | null
  lesson_date: string | null
  plan: Plan
  created_at: string
  // set when the plan is one day of a weekly plan
  week_group?: string | null
  week_no?: number | null
  term?: string | null
  academic_year?: string | null
}

export const PLAN_COLUMNS =
  'id, title, class_name, subject, strand, sub_strand, content_standard, indicators, duration_minutes, class_size, lesson_date, plan, created_at'
export const PLAN_COLUMNS_WEEK = `${PLAN_COLUMNS}, week_group, week_no, term, academic_year`

/** Nursery, creche and KG classes get a play-based plan (same rule as the function) */
export const isEarlyYears = (className: string) => /\b(creche|nursery|kg|kindergarten)\b/i.test(className)

export const toLines = (a: string[]) => a.join('\n')
export const fromLines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

export function fmtDate(iso: string | null) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** The message a function sent back, or a plain one when the server could not be reached */
export async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.error) return String(body.error)
    } catch {
      /* fall through */
    }
  }
  const msg = (error as { message?: string } | null)?.message ?? ''
  if (/failed to send|fetch|network/i.test(msg)) return 'Could not reach the server. Check your internet connection and try again.'
  return msg || 'Something went wrong. Please try again.'
}
