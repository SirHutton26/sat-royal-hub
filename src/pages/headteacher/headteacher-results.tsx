import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, ChevronDown, ChevronRight, Loader2, School, TrendingUp, Trophy, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TERMS } from '@/lib/report-card'
import { fetchAll } from '@/lib/headteacher'
import { aggregate, orderSubjects } from '@/lib/master-result'
import type { TermDate } from '@/lib/terms'

interface R {
  student_id: string
  class_id: string
  subject: string
  total_score: number | string | null
}
interface Stu {
  id: string
  full_name: string
  class_id: string
}
interface Sess {
  id: string
  term: string
  exam_type: string
  start_date: string
  end_date: string
}
interface Cfg {
  class_id: string
  subject: string
  term: string
  exam_session_id: string | null
}
interface Meta {
  sessions: Sess[]
  cfgs: Cfg[]
  termDates: TermDate[]
  currentYear: string
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

const EXAM_ORDER = ['Mid Term Exam', 'End of Term Exam', 'Mock Exam', 'Promotional Exam']
const examRank = (t: string) => {
  const i = EXAM_ORDER.indexOf(t)
  return i < 0 ? 99 : i
}

/**
 * Results are not stamped with a year in the database, so the year is read from the exam session
 * they are linked to: the term dates that contain the session's start date, otherwise the usual
 * September to July school year.
 */
function academicYearOf(iso: string, termDates: TermDate[]): string {
  const td = termDates.find((t) => t.start_date && t.end_date && iso >= t.start_date && iso <= t.end_date)
  if (td) return td.academic_year
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  return m >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`
}

const tone = (a: number) => (a >= 68 ? 'bg-green-500' : a >= 54 ? 'bg-gold-400' : a >= 40 ? 'bg-orange-500' : 'bg-red-500')

/** Results overview: pick the academic year, the term and the exam, then see class averages, top students and subject averages */
export default function HeadteacherResults() {
  const [year, setYear] = useState('')
  const [term, setTerm] = useState(TERMS[0])
  const [exam, setExam] = useState('') // '' = overall SBA total, otherwise an exam type
  const [meta, setMeta] = useState<Meta | null>(null)
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [students, setStudents] = useState<Stu[]>([])
  const [results, setResults] = useState<R[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [subjectClass, setSubjectClass] = useState('')
  const [sortBy, setSortBy] = useState<'class' | 'average'>('class')

  useEffect(() => {
    supabase.from('classes').select('id, name').order('name').then(({ data }) => setClasses((data ?? []) as { id: string; name: string }[]))
    fetchAll<Stu>((a, b) => supabase.from('students').select('id, full_name, class_id').eq('is_active', true).range(a, b)).then(setStudents)
    void (async () => {
      const [st, td, ss, cfgs] = await Promise.all([
        supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
        supabase.from('term_dates').select('academic_year, term, start_date, end_date'),
        supabase.from('exam_sessions').select('id, term, exam_type, start_date, end_date'),
        fetchAll<Cfg>((a, b) => supabase.from('sba_configs').select('class_id, subject, term, exam_session_id').range(a, b)),
      ])
      const termDates = (td.data ?? []) as TermDate[]
      if (st.data?.current_term && TERMS.includes(st.data.current_term)) setTerm(st.data.current_term)
      const currentYear = (st.data?.current_academic_year as string | undefined) || academicYearOf(new Date().toISOString().slice(0, 10), termDates)
      setMeta({ sessions: (ss.data ?? []) as Sess[], cfgs, termDates, currentYear })
    })()
  }, [])

  const lookups = useMemo(() => {
    if (!meta) return null
    const sessYear = new Map(meta.sessions.map((s) => [s.id, academicYearOf(s.start_date, meta.termDates)]))
    const cfgSession = new Map(meta.cfgs.filter((c) => c.exam_session_id).map((c) => [`${c.class_id}|${c.subject}|${c.term}`, c.exam_session_id as string]))
    return { sessYear, cfgSession }
  }, [meta])

  const years = useMemo(() => {
    if (!meta || !lookups) return []
    const s = new Set<string>([...lookups.sessYear.values(), meta.currentYear])
    return [...s].sort().reverse()
  }, [meta, lookups])

  useEffect(() => {
    if (meta && years.length && !years.includes(year)) setYear(years.includes(meta.currentYear) ? meta.currentYear : years[0])
  }, [meta, years, year])

  // exam sessions that belong to the chosen year and term
  const sessionsHere = useMemo<Sess[]>(
    () => (meta && lookups ? meta.sessions.filter((s) => s.term === term && lookups.sessYear.get(s.id) === year) : []),
    [meta, lookups, term, year],
  )
  const examTypes = useMemo<string[]>(() => [...new Set<string>(sessionsHere.map((s) => s.exam_type))].sort((a, b) => examRank(a) - examRank(b) || a.localeCompare(b)), [sessionsHere])

  useEffect(() => {
    if (exam && !examTypes.includes(exam)) setExam('')
  }, [examTypes, exam])

  useEffect(() => {
    if (!meta || !lookups || !year) return
    let alive = true
    setResults(null)
    setOpen(null)
    void (async () => {
      let rows: R[]
      if (!exam) {
        const all = await fetchAll<R>((a, b) => supabase.from('sba_results').select('student_id, class_id, subject, total_score').eq('term', term).range(a, b))
        rows = all.filter((r) => {
          const sid = lookups.cfgSession.get(`${r.class_id}|${r.subject}|${term}`)
          const y = sid ? lookups.sessYear.get(sid) : undefined
          return (y ?? meta.currentYear) === year
        })
      } else {
        const ids = sessionsHere.filter((s) => s.exam_type === exam).map((s) => s.id)
        const sc = ids.length
          ? await fetchAll<{ student_id: string; class_id: string; subject: string; exam_session_id: string; score: number | string | null }>((a, b) =>
              supabase.from('exam_scores').select('student_id, class_id, subject, exam_session_id, score').in('exam_session_id', ids).range(a, b),
            )
          : []
        rows = sc
          .filter((x) => x.score !== null && lookups.cfgSession.get(`${x.class_id}|${x.subject}|${term}`) === x.exam_session_id)
          .map((x) => ({ student_id: x.student_id, class_id: x.class_id, subject: x.subject, total_score: x.score }))
      }
      if (alive) setResults(rows)
    })()
    return () => {
      alive = false
    }
  }, [meta, lookups, year, term, exam, sessionsHere])

  const data = useMemo(() => {
    if (!results) return null
    const name = new Map(students.map((s) => [s.id, s.full_name]))
    // per class: the subjects that have saved results, and each student's scores (missing = 0, as on the Master Result)
    const byClassSubj = new Map<string, Set<string>>()
    const scoreOf = new Map<string, Record<string, number>>()
    for (const r of results) {
      if (r.total_score === null) continue
      byClassSubj.set(r.class_id, (byClassSubj.get(r.class_id) ?? new Set()).add(r.subject))
      const m = scoreOf.get(r.student_id) ?? {}
      m[r.subject] = Number(r.total_score)
      scoreOf.set(r.student_id, m)
    }
    const people: { id: string; name: string; classId: string; average: number; total: number; agg: number | null; complete: boolean; hasAny: boolean }[] = []
    for (const c of classes) {
      const subs = orderSubjects([...(byClassSubj.get(c.id) ?? [])])
      if (!subs.length) continue
      for (const st of students.filter((x) => x.class_id === c.id)) {
        const sc = scoreOf.get(st.id) ?? {}
        const total = subs.reduce((t, sub) => t + (sc[sub] ?? 0), 0)
        people.push({
          id: st.id, name: name.get(st.id) ?? '', classId: c.id, total, average: total / subs.length,
          agg: aggregate(subs, sc), complete: subs.every((sub) => sc[sub] !== undefined), hasAny: subs.some((sub) => sc[sub] !== undefined),
        })
      }
    }
    const byClass = classes.map((c) => {
      const mine = people.filter((p) => p.classId === c.id).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      return { c, count: mine.filter((p) => p.complete).length, roll: students.filter((s) => s.class_id === c.id).length, hasResults: mine.length > 0, average: avg(mine.map((p) => p.average)), top: mine.slice(0, 3), best: mine[0]?.average ?? 0 }
    })
    const school = [...people].sort((a, b) => b.average - a.average).slice(0, 10)
    return { byClass, school, schoolAvg: avg(people.map((p) => p.average)), graded: people.filter((p) => p.hasAny).length }
  }, [results, students, classes])

  // open the subject averages on a class that has results
  useEffect(() => {
    if (!data) return
    const withRes = data.byClass.filter((x) => x.hasResults)
    if (withRes.length) setSubjectClass((cur) => (withRes.some((x) => x.c.id === cur) ? cur : withRes[0].c.id))
  }, [data])

  const classRows = useMemo(() => {
    if (!data) return []
    const rows = [...data.byClass]
    if (sortBy === 'average') rows.sort((a, b) => Number(b.hasResults) - Number(a.hasResults) || b.average - a.average)
    return rows
  }, [data, sortBy])

  const subjectRows = useMemo(() => {
    if (!results || !subjectClass) return []
    const roll = students.filter((x) => x.class_id === subjectClass).map((x) => x.id)
    const m = new Map<string, Map<string, number>>()
    for (const r of results) {
      if (r.class_id !== subjectClass || r.total_score === null) continue
      const mm = m.get(r.subject) ?? new Map<string, number>()
      mm.set(r.student_id, Number(r.total_score))
      m.set(r.subject, mm)
    }
    return orderSubjects([...m.keys()]).map((subject) => ({ subject, average: avg(roll.map((id) => m.get(subject)?.get(id) ?? 0)), n: roll.length }))
  }, [results, subjectClass, students])

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? ''
  const examLabel = exam || 'SBA total'
  const bestClass = data ? [...data.byClass].filter((x) => x.hasResults).sort((a, b) => b.average - a.average)[0] : undefined
  const topStudent = data?.school[0]

  const stepLabel = (n: number, text: string) => (
    <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-royal-600 text-[11px] font-bold normal-case text-white">{n}</span>
      {text}
    </p>
  )

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-royal-900">Results overview</h1>
      <p className="mt-1 text-sm text-gray-500">
        Pick the academic year, the term and the exam. A missing result counts as 0 and every student is ranked.
        {!exam && ' With SBA total selected, the figures are the same as each class\u2019s Master Result.'}
      </p>

      {/* ---- filters ---- */}
      <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div>
            {stepLabel(1, 'Academic year')}
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-40 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-royal-900 outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              aria-label="Academic year"
            >
              {years.length === 0 && <option value="">Loading...</option>}
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            {stepLabel(2, 'Term')}
            <div className="inline-flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Term">
              {TERMS.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={term === t}
                  onClick={() => setTerm(t)}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${term === t ? 'bg-white text-royal-900 shadow-sm' : 'text-gray-500 hover:text-royal-900'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 flex-1 basis-72">
            {stepLabel(3, 'Exam')}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Exam">
              {['', ...examTypes].map((t) => (
                <button
                  key={t || 'sba'}
                  role="tab"
                  aria-selected={exam === t}
                  onClick={() => setExam(t)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    exam === t ? 'border-royal-600 bg-royal-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:border-royal-400 hover:text-royal-900'
                  }`}
                >
                  {t || 'SBA total'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              {examTypes.length === 0 ? 'No exam has been linked to results for this year and term yet.' : exam ? 'Exam scores out of 100.' : 'Overall SBA total for the term.'}
            </p>
          </div>
        </div>
      </section>

      {!data ? (
        <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-royal-600" /></div>
      ) : data.graded === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
          <p className="font-semibold text-royal-900">No saved results</p>
          <p className="mt-1 text-sm text-gray-500">
            Nothing found for {year}, {term}, {examLabel}. Try another exam or term, or check that teachers have saved their results.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-5 text-xs font-medium text-gray-500">
            Showing <b className="text-royal-900">{year}</b> · <b className="text-royal-900">{term}</b> · <b className="text-royal-900">{examLabel}</b>
          </p>

          {/* ---- headline figures ---- */}
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: TrendingUp, k: 'School average', v: f1(data.schoolAvg), sub: 'out of 100' },
              { icon: Users, k: 'Students with results', v: String(data.graded), sub: 'at least one subject saved' },
              { icon: School, k: 'Best class', v: bestClass?.c.name ?? '-', sub: bestClass ? `average ${f1(bestClass.average)}` : '' },
              { icon: Trophy, k: 'Top student', v: topStudent?.name ?? '-', sub: topStudent ? `${f1(topStudent.average)} · ${className(topStudent.classId)}` : '' },
            ].map(({ icon: Icon, k, v, sub }) => (
              <div key={k} className="flex gap-3 rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-500">{k}</p>
                  <p className="truncate text-lg font-bold leading-tight text-royal-900">{v}</p>
                  <p className="truncate text-xs text-gray-400">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ---- class averages ---- */}
          <section className="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
              <div>
                <h2 className="font-semibold text-royal-900">Class averages</h2>
                <p className="text-xs text-gray-500">Tap a class to see its top 3 students. “With results” counts students who have every subject saved.</p>
              </div>
              <button
                onClick={() => setSortBy(sortBy === 'class' ? 'average' : 'class')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-royal-900 hover:bg-gray-50"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortBy === 'class' ? 'Sort by average' : 'Sort by class'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Class</th>
                    <th className="px-2 py-2 text-right">With results</th>
                    <th className="px-2 py-2 text-right">Highest</th>
                    <th className="w-56 px-4 py-2">Class average</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((r) => (
                    <Fragment key={r.c.id}>
                      <tr
                        onClick={() => r.hasResults && setOpen(open === r.c.id ? null : r.c.id)}
                        className={`border-t border-gray-100 ${r.hasResults ? 'cursor-pointer hover:bg-royal-50/60' : 'opacity-60'}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-royal-900">
                          <span className="flex items-center gap-1.5">
                            {r.hasResults ? open === r.c.id ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" /> : <span className="w-4" />}
                            {r.c.name}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right text-gray-600">{r.count}/{r.roll}</td>
                        <td className="px-2 py-2.5 text-right text-gray-600">{r.hasResults ? f1(r.best) : '-'}</td>
                        <td className="px-4 py-2.5">
                          {r.hasResults ? (
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                <div className={`h-full rounded-full ${tone(r.average)}`} style={{ width: `${Math.min(100, r.average)}%` }} />
                              </div>
                              <span className="w-10 text-right text-xs font-semibold text-royal-900">{f1(r.average)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">no results</span>
                          )}
                        </td>
                      </tr>
                      {open === r.c.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={4} className="px-4 py-3 text-sm">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Top students in {r.c.name}</p>
                            <ol className="space-y-1">
                              {r.top.map((p, i) => (
                                <li key={p.id} className="flex justify-between">
                                  <span>{i + 1}. {p.name}</span>
                                  <span className="font-semibold text-royal-900">
                                    {f1(p.average)}
                                    {p.agg !== null && <span className="ml-2 text-xs font-normal text-gray-500">Agg. {p.agg}</span>}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
              {[['bg-green-500', '68 and above'], ['bg-gold-400', '54 to 67'], ['bg-orange-500', '40 to 53'], ['bg-red-500', 'below 40']].map(([c, t]) => (
                <span key={t} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${c}`} />{t}</span>
              ))}
            </div>
          </section>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-royal-900">Top 10 students in the school</h2>
              <ol className="mt-3 space-y-2">
                {data.school.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-gold-400 text-royal-900' : i === 1 ? 'bg-gray-300 text-royal-900' : i === 2 ? 'bg-orange-300 text-royal-900' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-royal-900">{p.name}</span>
                      <span className="text-xs text-gray-400">{className(p.classId)}</span>
                    </span>
                    <span className="font-semibold">{f1(p.average)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-gray-400">Ranked by the average of each student's subject scores.</p>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-royal-900">Subject averages</h2>
              <select
                value={subjectClass}
                onChange={(e) => setSubjectClass(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              >
                <option value="">Choose a class...</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ul className="mt-3 space-y-2.5">
                {subjectRows.map((s) => (
                  <li key={s.subject}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-royal-900">{s.subject}</span>
                      <span className="font-semibold">{f1(s.average)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full ${tone(s.average)}`} style={{ width: `${Math.min(100, s.average)}%` }} />
                    </div>
                  </li>
                ))}
                {subjectClass && subjectRows.length === 0 && <li className="text-sm text-gray-500">No results for this class.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}