// Writes a teacher's weekly plan from the scheme of learning: one lesson for each day the teacher picked.
//
// Uses the same secrets as generate-lesson-plan: GEMINI_API_KEY (required), GEMINI_MODEL, LESSON_PLAN_DAILY_LIMIT.
// One weekly plan counts as one use of the teacher's daily limit.
//
// Deploy:  supabase functions deploy generate-weekly-plan
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GeminiError, clean, generateWeek, type Indicator, type WeekDay, type WeekInput, type WeekItem } from '../_shared/lesson-plan.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const problem = (error: string, code: string) => json({ error, code })

const SAVED =
  'id, title, class_name, subject, strand, sub_strand, content_standard, indicators, duration_minutes, class_size, lesson_date, plan, created_at, week_group, week_no, term, academic_year'
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Who is asking
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) return json({ error: 'Not signed in' }, 401)
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', auth.user.id).maybeSingle()
    if (!me?.is_active || !['teacher', 'headteacher', 'admin'].includes(me.role)) return json({ error: 'Not allowed' }, 403)

    // What was asked
    const body = await req.json().catch(() => ({}))
    const rawDays: { label?: unknown; date?: unknown; minutes?: unknown }[] = Array.isArray(body.days) ? body.days.slice(0, 5) : []
    const days: WeekDay[] = []
    for (const d of rawDays) {
      const label = String(d.label ?? '')
      const minutes = Math.round(Number(d.minutes))
      if (!WEEKDAYS.includes(label)) return problem('Choose the days from Monday to Friday.', 'bad_request')
      if (days.some((x) => x.label === label)) return problem('Each day can only be chosen once.', 'bad_request')
      if (!(minutes >= 20 && minutes <= 180)) return problem('Each lesson must be between 20 and 180 minutes.', 'bad_request')
      days.push({ label, minutes, date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? '')) ? String(d.date) : null })
    }
    if (!days.length) return problem('Choose at least one day for this subject.', 'bad_request')
    days.sort((a, b) => WEEKDAYS.indexOf(a.label) - WEEKDAYS.indexOf(b.label))

    const { data: week } = await admin
      .from('scheme_weeks')
      .select('id, academic_year, term, class_name, subject, subject_key, week_no, kind, topic, items')
      .eq('id', String(body.schemeWeekId ?? ''))
      .maybeSingle()
    if (!week) return problem('That week of the scheme of learning could not be found. Please choose it again.', 'bad_request')
    if (week.kind === 'exam') return problem('This week is for examinations, so there is no lesson plan to write.', 'bad_request')
    if (week.kind === 'sba') return problem('This week is for SBA activities, so there is no lesson plan to write.', 'bad_request')

    const className = clean(body.className, 80) || week.class_name
    const subject = clean(body.subject, 80) || week.subject
    const size = Math.round(Number(body.classSize))
    const classSize = Number.isFinite(size) && size >= 1 && size <= 200 ? size : null
    const notes = clean(body.notes, 300)

    // The week's content, as the scheme gives it
    const items: WeekItem[] = (Array.isArray(week.items) ? week.items : []).slice(0, 8).map(
      (it: { strand?: string; sub_strand?: string; content_standard?: string; resources?: string; indicators?: { code?: string; text?: string }[] }) => ({
        strand: clean(it.strand, 200),
        subStrand: clean(it.sub_strand, 200),
        contentStandard: clean(it.content_standard, 500),
        resources: clean(it.resources, 500),
        indicators: (Array.isArray(it.indicators) ? it.indicators : []).slice(0, 10).map((i): Indicator => ({ code: clean(i.code, 40), text: clean(i.text, 600) })),
      }),
    )
    const topic = clean(week.topic, 200)

    // Exemplars from the NaCCA curriculum for the indicators of this week, when that subject's curriculum is loaded.
    // The same code (B7.1.1.1.1) exists in every subject, so the class and the subject must match too, and a scheme code
    // such as B7/JHS1.4.1.1.1 is the curriculum's B7.4.1.1.1.
    const codes = [...new Set(items.flatMap((it) => it.indicators.map((i) => i.code.replace(/\/JHS\d/i, '')).filter(Boolean)))].slice(0, 20)
    let exemplars: string[] = []
    if (codes.length) {
      const { data: ex } = await admin
        .from('curriculum_items')
        .select('exemplar')
        .in('indicator_code', codes)
        .ilike('class_name', week.class_name)
        .eq('subject_key', week.subject_key)
      exemplars = [...new Set((ex ?? []).map((r: { exemplar: string | null }) => clean(r.exemplar, 1500)).filter(Boolean))].slice(0, 8)
    }

    // A revision week revises what was taught earlier in the term
    let revisionTopics: string[] = []
    if (week.kind === 'revision') {
      const { data: before } = await admin
        .from('scheme_weeks')
        .select('topic, week_no, items')
        .eq('academic_year', week.academic_year)
        .eq('term', week.term)
        .eq('subject_key', week.subject_key)
        .ilike('class_name', week.class_name)
        .eq('kind', 'lesson')
        .lt('week_no', week.week_no)
        .order('week_no')
      revisionTopics = [...new Set((before ?? []).map((r: { topic: string | null; items: { sub_strand?: string }[] }) => clean(r.topic || r.items?.[0]?.sub_strand, 200)).filter(Boolean))].slice(0, 14)
    }

    // A week that has only a topic: find the curriculum indicators for it and where this week sits in the topic
    let curriculumHints: string[] = []
    let topicPosition: { n: number; of: number } | null = null
    if (week.kind === 'lesson' && !items.length && topic) {
      const { data: same } = await admin
        .from('scheme_weeks')
        .select('week_no')
        .eq('academic_year', week.academic_year)
        .eq('term', week.term)
        .eq('subject_key', week.subject_key)
        .ilike('class_name', week.class_name)
        .eq('topic', week.topic)
        .order('week_no')
      const nos = (same ?? []).map((r: { week_no: number }) => r.week_no)
      if (nos.length) topicPosition = { n: Math.max(1, nos.indexOf(week.week_no) + 1), of: nos.length }
      const like = `%${topic.replace(/[%_]/g, ' ')}%`
      const { data: cur } = await admin
        .from('curriculum_items')
        .select('indicator_code, indicator')
        .ilike('class_name', week.class_name)
        .eq('subject_key', week.subject_key)
        .ilike('sub_strand', like)
        .order('sort_order')
        .limit(14)
      curriculumHints = (cur ?? []).map((r: { indicator_code: string | null; indicator: string }) => `${r.indicator_code ? `[${r.indicator_code}] ` : ''}${clean(r.indicator, 500)}`)
    }

    // Daily limit per teacher (Ghana is on UTC all year)
    const limit = Math.max(1, Number(Deno.env.get('LESSON_PLAN_DAILY_LIMIT') ?? '6') || 6)
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count } = await admin
      .from('lesson_plan_usage')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', auth.user.id)
      .gte('created_at', dayStart.toISOString())
    const used = count ?? 0
    if (used >= limit) return problem(`You have used your ${limit} lesson plans for today. Please try again tomorrow.`, 'limit')

    // Write the week
    const input: WeekInput = {
      className, subject, term: week.term, weekNo: week.week_no, kind: week.kind === 'revision' ? 'revision' : 'lesson',
      topic, items, exemplars, curriculumHints, topicPosition, revisionTopics, days, classSize, notes,
    }
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
    let plans
    try {
      plans = await generateWeek(input, { apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model })
    } catch (e) {
      if (e instanceof GeminiError) {
        console.error('gemini:', e.kind, e.message)
        if (e.kind === 'not_configured') return problem('AI lesson plans are not set up yet. Please tell the administrator.', e.kind)
        if (e.kind === 'bad_key' || e.kind === 'bad_model') return problem('The AI service is not working right now. Please tell the administrator.', e.kind)
        return problem(e.message, e.kind)
      }
      throw e
    }

    // Save one lesson plan for each day; they share a week_group
    const weekGroup = crypto.randomUUID()
    const indicators = items.flatMap((it) => it.indicators)
    const rows = plans.map((plan, i) => ({
      teacher_id: auth.user!.id,
      title: plan.title,
      class_name: className,
      subject,
      strand: items[0]?.strand || null,
      sub_strand: items[0]?.subStrand || topic || null,
      content_standard: items.map((it) => it.contentStandard).filter(Boolean).join('; ').slice(0, 600) || null,
      indicators,
      duration_minutes: days[i].minutes,
      class_size: classSize,
      lesson_date: days[i].date,
      plan,
      model,
      week_group: weekGroup,
      scheme_week_id: week.id,
      week_no: week.week_no,
      term: week.term,
      academic_year: week.academic_year,
    }))
    const { data: saved, error: saveError } = await admin.from('lesson_plans').insert(rows).select(SAVED)
    if (saveError || !saved?.length) {
      console.error('save weekly plan:', saveError?.message)
      return json({ error: 'The plan was written but could not be saved. Please try again.' }, 500)
    }
    await admin.from('lesson_plan_usage').insert({ teacher_id: auth.user.id })

    return json({ plans: saved, week_group: weekGroup, remaining: Math.max(0, limit - used - 1) })
  } catch (e) {
    console.error('generate-weekly-plan:', e)
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500)
  }
})
