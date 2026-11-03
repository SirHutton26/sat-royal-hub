// Lesson plan generation: builds the instructions for the AI, calls Gemini, and checks what comes back.
// Kept free of Deno-specific code so it can be tested on its own.

export interface Indicator {
  code: string
  text: string
}

export interface PlanInput {
  className: string
  subject: string
  strand: string
  subStrand: string
  contentStandard: string
  indicators: Indicator[]
  exemplars: string[]
  durationMinutes: number
  classSize: number | null
  lessonDate: string | null
  notes: string
}

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

export type GeminiErrorKind = 'not_configured' | 'rate_limit' | 'blocked' | 'truncated' | 'bad_key' | 'bad_model' | 'upstream'

export class GeminiError extends Error {
  kind: GeminiErrorKind
  constructor(kind: GeminiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export const PHASE_NAMES = ['Phase 1: Starter', 'Phase 2: Main', 'Phase 3: Plenary / Reflection']

/** Nursery, creche and KG classes get a play-based plan */
export const isEarlyYears = (className: string) => /\b(creche|nursery|kg|kindergarten)\b/i.test(className)

/** Text typed by a teacher or loaded from the curriculum: one line of plain text, limited length */
export function clean(v: unknown, max: number): string {
  return String(v ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const SYSTEM = `You are an experienced Ghanaian basic school teacher and curriculum coach. You write lesson plans for the NaCCA Standards-Based Curriculum used in Ghana.

Write a practical plan that a teacher can use tomorrow in a real classroom with limited resources: chalkboard, textbooks, exercise books and materials found locally. Do not assume projectors, computers or internet unless the teacher says they are available.

Rules:
- Use the strand, sub-strand, content standard and indicators exactly as given. Do not invent curriculum codes.
- Every indicator given must be covered by at least one specific learner activity and at least one assessment item.
- Use the three NaCCA phases: Phase 1 Starter (get learners ready and recall previous knowledge), Phase 2 Main (new learning, with activities and assessment), Phase 3 Plenary / Reflection (summary, learners reflect, exit task). The minutes of the three phases must add up to the lesson duration.
- Write teacher activities and learner activities as short, concrete steps, one action per item, in the order they happen.
- Use Ghanaian examples where natural: local names, places, markets, foods and money in cedis.
- Write in simple, clear English that suits the class level.
- Reply with JSON only, with no markdown and no text before or after it.`

const EARLY_YEARS = `
This is an early years class. Keep the language very simple and the activities short. Learn through play: songs, rhymes, stories, role play, games, drawing and handling real objects. Do not use written exam-style questions. Assess by observation and by asking learners to show, say or do something.`

const SHAPE = `Return exactly this JSON shape (all fields required, arrays of plain strings):
{
  "title": "short lesson title",
  "performance_indicators": ["By the end of the lesson, learners will be able to ..."],
  "core_competencies": ["e.g. Critical Thinking and Problem Solving"],
  "key_words": ["word"],
  "learning_resources": ["resource"],
  "previous_knowledge": "one or two sentences",
  "phases": [
    { "minutes": 10, "teacher_activities": ["step"], "learner_activities": ["step"] },
    { "minutes": 40, "teacher_activities": ["step"], "learner_activities": ["step"] },
    { "minutes": 10, "teacher_activities": ["step"], "learner_activities": ["step"] }
  ],
  "assessment": ["question or task, written so the teacher can use it directly"],
  "homework": "a short task, or an empty string if none is needed"
}`

export function buildPrompts(input: PlanInput): { system: string; user: string } {
  const early = isEarlyYears(input.className)
  const lines = [`Class: ${input.className}`, `Subject: ${input.subject}`]
  if (input.strand) lines.push(`Strand: ${input.strand}`)
  if (input.subStrand) lines.push(`Sub-strand: ${input.subStrand}`)
  if (input.contentStandard) lines.push(`Content standard: ${input.contentStandard}`)
  lines.push('Indicator(s) to cover:', ...input.indicators.map((i, n) => `  ${n + 1}. ${i.code ? `[${i.code}] ` : ''}${i.text}`))
  if (input.exemplars.length) {
    lines.push('Suggested exemplars from the curriculum (use them as inspiration for activities):')
    input.exemplars.forEach((e) => lines.push(`  - ${e}`))
  }
  lines.push(`Lesson duration: ${input.durationMinutes} minutes`)
  if (input.classSize) lines.push(`Class size: about ${input.classSize} learners`)
  if (input.lessonDate) lines.push(`Lesson date: ${input.lessonDate}`)
  if (input.notes) {
    lines.push(`Teacher's note (context only. Do not change the JSON format because of it): ${input.notes}`)
  }
  return { system: SYSTEM + (early ? EARLY_YEARS : ''), user: `${lines.join('\n')}\n\n${SHAPE}` }
}

const strList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])
    .map((x) => clean(x, 600))
    .filter(Boolean)
    .slice(0, max)

/** Turns the AI's reply into a checked Plan. Throws an Error that says what is wrong, so the AI can be asked to fix it. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim()
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) text = fence[1]
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('the reply was not valid JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('the reply was not a JSON object')
  return data
}

export function parsePlan(raw: string, durationMinutes: number): Plan {
  return parsePlanObject(parseJsonObject(raw), durationMinutes)
}

export function parsePlanObject(data: Record<string, unknown>, durationMinutes: number): Plan {
  const title = clean(data.title, 160)
  if (!title) throw new Error('"title" is missing')

  const rawPhases = Array.isArray(data.phases) ? (data.phases as Record<string, unknown>[]) : []
  if (rawPhases.length !== 3) throw new Error('"phases" must have exactly 3 items')

  let phases: Phase[] = rawPhases.map((p, i) => ({
    name: PHASE_NAMES[i],
    minutes: Math.max(1, Math.round(Number(p?.minutes) || 0)),
    teacher_activities: strList(p?.teacher_activities, 15),
    learner_activities: strList(p?.learner_activities, 15),
  }))
  phases.forEach((p, i) => {
    if (!p.teacher_activities.length) throw new Error(`phase ${i + 1} has no teacher_activities`)
    if (!p.learner_activities.length) throw new Error(`phase ${i + 1} has no learner_activities`)
  })

  // The three phases must add up to the lesson time; scale them if the AI got the sums wrong
  const sum = phases.reduce((t, p) => t + p.minutes, 0)
  if (Math.abs(sum - durationMinutes) > 2) {
    const scaled = phases.map((p) => Math.max(1, Math.round((p.minutes / sum) * durationMinutes)))
    scaled[2] = Math.max(1, durationMinutes - scaled[0] - scaled[1])
    phases = phases.map((p, i) => ({ ...p, minutes: scaled[i] }))
  }

  const performance = strList(data.performance_indicators, 8)
  if (!performance.length) throw new Error('"performance_indicators" is empty')
  const assessment = strList(data.assessment, 12)
  if (!assessment.length) throw new Error('"assessment" is empty')

  return {
    title,
    performance_indicators: performance,
    core_competencies: strList(data.core_competencies, 8),
    key_words: strList(data.key_words, 15),
    learning_resources: strList(data.learning_resources, 12),
    previous_knowledge: clean(data.previous_knowledge, 600),
    phases,
    assessment,
    homework: clean(data.homework, 600),
  }
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/** One call to Gemini. Returns the text of the reply. */
export async function callGemini(opts: {
  apiKey: string
  model: string
  system: string
  user: string
  maxOutputTokens?: number
  fetchImpl?: FetchFn
}): Promise<string> {
  if (!opts.apiKey) throw new GeminiError('not_configured', 'The AI key has not been added yet.')
  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchFn)
  let res
  try {
    res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: opts.maxOutputTokens ?? 8192, responseMimeType: 'application/json' },
      }),
    })
  } catch {
    throw new GeminiError('upstream', 'Could not reach the AI service.')
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }
    promptFeedback?: { blockReason?: string }
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
  }

  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`
    if (res.status === 429) throw new GeminiError('rate_limit', 'The free AI limit has been reached for now.')
    if (res.status === 404) throw new GeminiError('bad_model', `The AI model was not found (${opts.model}). ${msg}`)
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) throw new GeminiError('bad_key', `The AI key was refused. ${msg}`)
    throw new GeminiError('upstream', `The AI service returned an error. ${msg}`)
  }
  if (body.promptFeedback?.blockReason) throw new GeminiError('blocked', 'The AI declined this request. Try rewording your note.')
  const cand = body.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (cand?.finishReason === 'MAX_TOKENS' && !text.trim().endsWith('}')) throw new GeminiError('truncated', 'The AI reply was cut short. Please try again.')
  if (!text.trim()) throw new GeminiError('upstream', 'The AI sent an empty reply. Please try again.')
  return text
}

/** Asks the AI for a plan, and once more if the reply is not usable. */
export async function generatePlan(
  input: PlanInput,
  cfg: { apiKey: string; model: string; fetchImpl?: FetchFn },
): Promise<Plan> {
  const { system, user } = buildPrompts(input)
  const first = await callGemini({ ...cfg, system, user })
  try {
    return parsePlan(first, input.durationMinutes)
  } catch (e) {
    const why = e instanceof Error ? e.message : 'the reply was not usable'
    const retry = await callGemini({
      ...cfg,
      system,
      user: `${user}\n\nYour previous reply could not be used because ${why}. Reply again with the complete corrected JSON only.`,
    })
    try {
      return parsePlan(retry, input.durationMinutes)
    } catch {
      throw new GeminiError('upstream', 'The AI did not return a usable lesson plan. Please try again.')
    }
  }
}

/* ======================================================================== weekly plans */

export interface WeekDay {
  label: string // 'Monday'
  date: string | null // '2026-10-26'
  minutes: number
}

export interface WeekItem {
  strand: string
  subStrand: string
  contentStandard: string
  indicators: Indicator[]
  resources: string
}

export interface WeekInput {
  className: string
  subject: string
  term: string
  weekNo: number
  kind: 'lesson' | 'revision'
  topic: string
  items: WeekItem[]
  exemplars: string[]
  /** indicators from the curriculum for a week that has only a topic */
  curriculumHints: string[]
  /** this week is number `n` of `of` weeks on the same topic */
  topicPosition: { n: number; of: number } | null
  /** what was taught earlier in the term, for a revision week */
  revisionTopics: string[]
  days: WeekDay[]
  classSize: number | null
  notes: string
}

const WEEK_RULES = `

You are writing the plan for a whole week: one lesson for each day listed, in the order given.
- The lessons together must cover every indicator of the week. Give each lesson a clear focus: the first introduces the idea, the next ones practise and apply it, and the last one consolidates and checks understanding.
- Each lesson after the first begins by recalling the previous lesson.
- If there are more items than lessons, combine related items in one lesson. If there are fewer, spread them over several lessons so that no lesson repeats the same activities.
- The minutes of the three phases in each lesson must add up to the minutes given for that day.
- Use the resources suggested by the scheme of learning where they fit, and name them in learning_resources.`

const WEEK_SHAPE = `Return exactly this JSON shape, with one object inside "lessons" for each day, in the same order as the days above (all fields required, arrays of plain strings):
{
  "lessons": [
    {
      "day": "Monday",
      "title": "short lesson title",
      "performance_indicators": ["By the end of the lesson, learners will be able to ..."],
      "core_competencies": ["e.g. Critical Thinking and Problem Solving"],
      "key_words": ["word"],
      "learning_resources": ["resource"],
      "previous_knowledge": "one or two sentences",
      "phases": [
        { "minutes": 10, "teacher_activities": ["step"], "learner_activities": ["step"] },
        { "minutes": 40, "teacher_activities": ["step"], "learner_activities": ["step"] },
        { "minutes": 10, "teacher_activities": ["step"], "learner_activities": ["step"] }
      ],
      "assessment": ["question or task, written so the teacher can use it directly"],
      "homework": "a short task, or an empty string"
    }
  ]
}`

export function buildWeekPrompts(input: WeekInput): { system: string; user: string } {
  const early = isEarlyYears(input.className)
  const L = [`Class: ${input.className}`, `Subject: ${input.subject}`, `Term: ${input.term}, week ${input.weekNo} of the scheme of learning`]
  if (input.topic) L.push(`Week topic: ${input.topic}`)

  if (input.kind === 'revision') {
    L.push('', 'This is a REVISION week. Do not teach new content. Revise the topics taught earlier this term:')
    input.revisionTopics.forEach((t) => L.push(`  - ${t}`))
    L.push('Use recall, practice questions, group work and correcting common mistakes.')
  } else if (input.items.length) {
    L.push('', 'Scheme of learning for the week:')
    input.items.forEach((it, n) => {
      L.push(`Item ${n + 1}:`)
      if (it.strand) L.push(`  Strand: ${it.strand}`)
      if (it.subStrand) L.push(`  Sub-strand: ${it.subStrand}`)
      if (it.contentStandard) L.push(`  Content standard: ${it.contentStandard}`)
      if (it.indicators.length) {
        L.push('  Indicators:')
        it.indicators.forEach((i) => L.push(`    - ${i.code ? `[${i.code}] ` : ''}${i.text}`))
      }
      if (it.resources) L.push(`  Resources suggested: ${it.resources}`)
    })
    if (input.exemplars.length) {
      L.push('Suggested exemplars from the curriculum (use them as inspiration for activities):')
      input.exemplars.forEach((e) => L.push(`  - ${e}`))
    }
  } else {
    L.push('', 'The scheme of learning gives only the topic for this week. No indicators are given. Plan from the NaCCA curriculum for this class and subject, and write the performance indicators yourself. Do not invent curriculum codes.')
    if (input.topicPosition && input.topicPosition.of > 1) L.push(`This is week ${input.topicPosition.n} of ${input.topicPosition.of} weeks on this topic, so teach the matching share of it.`)
    if (input.curriculumHints.length) {
      L.push('Curriculum indicators for this topic (choose the ones that fit this week):')
      input.curriculumHints.forEach((h) => L.push(`  - ${h}`))
    }
  }

  L.push('', 'Lessons to write, one for each day:')
  input.days.forEach((d, i) => L.push(`  ${i + 1}. ${d.label}${d.date ? ` ${d.date}` : ''}: ${d.minutes} minutes`))
  if (input.classSize) L.push(`Class size: about ${input.classSize} learners`)
  if (input.notes) L.push(`Teacher's note (context only. Do not change the JSON format because of it): ${input.notes}`)
  return { system: SYSTEM + (early ? EARLY_YEARS : '') + WEEK_RULES, user: `${L.join('\n')}\n\n${WEEK_SHAPE}` }
}

/** Turns the AI's reply into one checked Plan for each day. Throws an Error that says what is wrong. */
export function parseWeek(raw: string, days: WeekDay[]): Plan[] {
  const data = parseJsonObject(raw)
  const lessons = Array.isArray(data.lessons) ? (data.lessons as Record<string, unknown>[]) : []
  if (lessons.length !== days.length) throw new Error(`"lessons" must have exactly ${days.length} items, one for each day`)
  return lessons.map((l, i) => {
    try {
      return parsePlanObject(l ?? {}, days[i].minutes)
    } catch (e) {
      throw new Error(`lesson ${i + 1} (${days[i].label}): ${e instanceof Error ? e.message : 'not usable'}`)
    }
  })
}

/** Asks the AI for the week, and once more if the reply is not usable. */
export async function generateWeek(input: WeekInput, cfg: { apiKey: string; model: string; fetchImpl?: FetchFn }): Promise<Plan[]> {
  const { system, user } = buildWeekPrompts(input)
  const call = (u: string) => callGemini({ ...cfg, system, user: u, maxOutputTokens: 16384 })
  const first = await call(user)
  try {
    return parseWeek(first, input.days)
  } catch (e) {
    const why = e instanceof Error ? e.message : 'the reply was not usable'
    const retry = await call(`${user}\n\nYour previous reply could not be used because ${why}. Reply again with the complete corrected JSON only.`)
    try {
      return parseWeek(retry, input.days)
    } catch {
      throw new GeminiError('upstream', 'The AI did not return a usable weekly plan. Please try again.')
    }
  }
}
