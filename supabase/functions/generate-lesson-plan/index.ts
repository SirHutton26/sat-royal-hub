// Writes a lesson plan with Gemini and saves it for the teacher.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   GEMINI_API_KEY            required. From aistudio.google.com
//   GEMINI_MODEL              optional. Default: gemini-flash-latest
//   LESSON_PLAN_DAILY_LIMIT   optional. Plans each teacher may generate per day. Default: 6
//
// Deploy:  supabase functions deploy generate-lesson-plan
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GeminiError, clean, generatePlan, type Indicator, type PlanInput } from '../_shared/lesson-plan.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// Problems the teacher can act on come back as 200 with { error, code }, so the app can show the message as written
const problem = (error: string, code: string) => json({ error, code })

const SAVED = 'id, title, class_name, subject, strand, sub_strand, content_standard, indicators, duration_minutes, class_size, lesson_date, plan, created_at'

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
    const className = clean(body.className, 80)
    const subject = clean(body.subject, 80)
    if (!className || !subject) return problem('Choose the class and the subject.', 'bad_request')
    const durationMinutes = Math.round(Number(body.durationMinutes))
    if (!(durationMinutes >= 20 && durationMinutes <= 180)) return problem('The lesson time must be between 20 and 180 minutes.', 'bad_request')
    const size = Math.round(Number(body.classSize))
    const classSize = Number.isFinite(size) && size >= 1 && size <= 200 ? size : null
    const lessonDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.lessonDate ?? '')) ? String(body.lessonDate) : null
    const notes = clean(body.notes, 300)

    // What the lesson is about: the chosen curriculum rows, or what the teacher typed when the curriculum is not loaded
    let strand = ''
    let subStrand = ''
    let contentStandard = ''
    let indicators: Indicator[] = []
    let exemplars: string[] = []
    const ids: string[] = Array.isArray(body.curriculumIds) ? body.curriculumIds.map(String).slice(0, 12) : []
    if (ids.length) {
      const { data: rows, error } = await admin
        .from('curriculum_items')
        .select('strand, sub_strand, content_standard_code, content_standard, indicator_code, indicator, exemplar, sort_order')
        .in('id', ids)
        .order('sort_order')
      if (error || !rows?.length) return problem('That part of the curriculum could not be found. Please choose it again.', 'bad_request')
      strand = clean(rows[0].strand, 200)
      subStrand = clean(rows[0].sub_strand, 200)
      const standards = [...new Set(rows.map((r) => `${r.content_standard_code ? `${r.content_standard_code} ` : ''}${r.content_standard}`))]
      contentStandard = clean(standards.join('; '), 600)
      indicators = rows.map((r) => ({ code: clean(r.indicator_code, 40), text: clean(r.indicator, 500) }))
      exemplars = [...new Set(rows.map((r) => clean(r.exemplar, 1500)).filter(Boolean))].slice(0, 8)
    } else {
      const m = body.manual ?? {}
      strand = clean(m.strand, 200)
      subStrand = clean(m.subStrand, 200)
      contentStandard = clean(m.contentStandard, 400)
      const indicator = clean(m.indicator, 500)
      if (!strand && !subStrand) return problem('Type the strand or topic for this lesson.', 'bad_request')
      if (!indicator) return problem('Type what learners should be able to do by the end of the lesson.', 'bad_request')
      indicators = [{ code: '', text: indicator }]
    }

    // Daily limit per teacher (Ghana is on UTC all year, so the day starts at UTC midnight)
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

    // Write the plan
    const input: PlanInput = { className, subject, strand, subStrand, contentStandard, indicators, exemplars, durationMinutes, classSize, lessonDate, notes }
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
    let plan
    try {
      plan = await generatePlan(input, { apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model })
    } catch (e) {
      if (e instanceof GeminiError) {
        console.error('gemini:', e.kind, e.message) // the details stay in the function logs
        if (e.kind === 'not_configured') return problem('AI lesson plans are not set up yet. Please tell the administrator.', e.kind)
        if (e.kind === 'bad_key' || e.kind === 'bad_model') return problem('The AI service is not working right now. Please tell the administrator.', e.kind)
        return problem(e.message, e.kind)
      }
      throw e
    }

    // Save it, then count it
    const { data: row, error: saveError } = await admin
      .from('lesson_plans')
      .insert({
        teacher_id: auth.user.id,
        title: plan.title,
        class_name: className,
        subject,
        strand: strand || null,
        sub_strand: subStrand || null,
        content_standard: contentStandard || null,
        indicators,
        duration_minutes: durationMinutes,
        class_size: classSize,
        lesson_date: lessonDate,
        plan,
        model,
      })
      .select(SAVED)
      .single()
    if (saveError || !row) {
      console.error('save lesson plan:', saveError?.message)
      return json({ error: 'The plan was written but could not be saved. Please try again.' }, 500)
    }
    await admin.from('lesson_plan_usage').insert({ teacher_id: auth.user.id })

    return json({ plan: row, remaining: Math.max(0, limit - used - 1) })
  } catch (e) {
    console.error('generate-lesson-plan:', e)
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500)
  }
})
