import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TERMS } from '@/lib/report-card'
import { fetchAll } from '@/lib/headteacher'

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

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/** Results overview from the teachers' saved SBA results: class averages, top students, subject averages */
export default function HeadteacherResults() {
  const [term, setTerm] = useState(TERMS[0])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [students, setStudents] = useState<Stu[]>([])
  const [results, setResults] = useState<R[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [subjectClass, setSubjectClass] = useState('')

  useEffect(() => {
    supabase.from('school_settings').select('current_term').limit(1).maybeSingle().then(({ data }) => {
      if (data?.current_term && TERMS.includes(data.current_term)) setTerm(data.current_term)
    })
    supabase.from('classes').select('id, name').order('name').then(({ data }) => setClasses((data ?? []) as { id: string; name: string }[]))
    fetchAll<Stu>((a, b) => supabase.from('students').select('id, full_name, class_id').eq('is_active', true).range(a, b)).then(setStudents)
  }, [])

  useEffect(() => {
    let alive = true
    setResults(null)
    fetchAll<R>((a, b) => supabase.from('sba_results').select('student_id, class_id, subject, total_score').eq('term', term).range(a, b)).then((r) => alive && setResults(r))
    return () => {
      alive = false
    }
  }, [term])

  const data = useMemo(() => {
    if (!results) return null
    const name = new Map(students.map((s) => [s.id, s.full_name]))
    const active = new Set(students.map((s) => s.id))
    const scores = new Map<string, { classId: string; totals: number[] }>()
    for (const r of results) {
      if (r.total_score === null || !active.has(r.student_id)) continue
      const e = scores.get(r.student_id) ?? { classId: r.class_id, totals: [] }
      e.totals.push(Number(r.total_score))
      scores.set(r.student_id, e)
    }
    const people = [...scores.entries()].map(([id, e]) => ({ id, name: name.get(id) ?? '', classId: e.classId, average: avg(e.totals), subjects: e.totals.length }))
    const byClass = classes.map((c) => {
      const mine = people.filter((p) => p.classId === c.id).sort((a, b) => b.average - a.average)
      return { c, count: mine.length, roll: students.filter((s) => s.class_id === c.id).length, average: avg(mine.map((p) => p.average)), top: mine.slice(0, 3), best: mine[0]?.average ?? 0 }
    })
    const school = [...people].sort((a, b) => b.average - a.average).slice(0, 10)
    return { byClass, school, schoolAvg: avg(people.map((p) => p.average)), graded: people.length }
  }, [results, students, classes])

  const subjectRows = useMemo(() => {
    if (!results || !subjectClass) return []
    const m = new Map<string, number[]>()
    for (const r of results) {
      if (r.class_id !== subjectClass || r.total_score === null) continue
      m.set(r.subject, [...(m.get(r.subject) ?? []), Number(r.total_score)])
    }
    return [...m.entries()].map(([subject, xs]) => ({ subject, average: avg(xs), n: xs.length })).sort((a, b) => b.average - a.average)
  }, [results, subjectClass])

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? ''
  const tone = (a: number) => (a >= 68 ? 'bg-green-500' : a >= 54 ? 'bg-gold-400' : a >= 40 ? 'bg-orange-500' : 'bg-red-500')

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Results overview</h1>
          <p className="mt-1 text-sm text-gray-500">From the results teachers have saved on the SBA page.</p>
        </div>
        <select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          {TERMS.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>

      {!data ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-royal-600" />
      ) : data.graded === 0 ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">No saved results for {term} yet.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['School average', f1(data.schoolAvg)], ['Students with results', data.graded], ['Best class', [...data.byClass].filter((x) => x.count).sort((a, b) => b.average - a.average)[0]?.c.name ?? '-'], ['Top student', data.school[0] ? `${data.school[0].name.split(' ')[0]} (${f1(data.school[0].average)})` : '-']].map(([k, v]) => (
              <div key={String(k)} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{k}</p>
                <p className="mt-1 truncate text-lg font-bold text-royal-900">{v}</p>
              </div>
            ))}
          </div>

          <section className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <h2 className="px-4 pt-4 font-semibold text-royal-900">Class averages</h2>
            <p className="px-4 text-xs text-gray-500">Tap a class to see its top 3 students.</p>
            <table className="mt-2 w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2">Class</th><th className="px-2 py-2 text-right">With results</th><th className="px-2 py-2 text-right">Highest</th><th className="w-48 px-4 py-2">Class average</th></tr>
              </thead>
              <tbody>
                {data.byClass.map((r) => (
                  <Fragment key={r.c.id}>
                    <tr onClick={() => r.count && setOpen(open === r.c.id ? null : r.c.id)} className={`border-t border-gray-100 ${r.count ? 'cursor-pointer hover:bg-royal-50/60' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-royal-900">
                        <span className="flex items-center gap-1.5">{r.count ? open === r.c.id ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" /> : <span className="w-4" />}{r.c.name}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-600">{r.count}/{r.roll}</td>
                      <td className="px-2 py-2.5 text-right text-gray-600">{r.count ? f1(r.best) : '-'}</td>
                      <td className="px-4 py-2.5">
                        {r.count ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${tone(r.average)}`} style={{ width: `${Math.min(100, r.average)}%` }} /></div>
                            <span className="w-10 text-right text-xs font-semibold text-royal-900">{f1(r.average)}</span>
                          </div>
                        ) : <span className="text-xs text-gray-400">no results</span>}
                      </td>
                    </tr>
                    {open === r.c.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={4} className="px-4 py-3 text-sm">
                          <ol className="space-y-1">
                            {r.top.map((p, i) => <li key={p.id} className="flex justify-between"><span>{i + 1}. {p.name}</span><span className="font-semibold text-royal-900">{f1(p.average)}</span></li>)}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-royal-900">Top 10 students in the school</h2>
              <ol className="mt-3 space-y-2">
                {data.school.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 text-sm">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-gold-400 text-royal-900' : 'bg-gray-100 text-gray-600'}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-royal-900">{p.name}</span><span className="text-xs text-gray-400">{className(p.classId)}</span></span>
                    <span className="font-semibold">{f1(p.average)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-gray-400">Ranked by the average of each student's subject totals.</p>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-royal-900">Subject averages</h2>
              <select value={subjectClass} onChange={(e) => setSubjectClass(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="">Choose a class...</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ul className="mt-3 space-y-2.5">
                {subjectRows.map((s) => (
                  <li key={s.subject}>
                    <div className="flex justify-between text-sm"><span className="font-medium text-royal-900">{s.subject}</span><span className="font-semibold">{f1(s.average)}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${tone(s.average)}`} style={{ width: `${Math.min(100, s.average)}%` }} /></div>
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
