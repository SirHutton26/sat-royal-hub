import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Loader2, Minus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { TERMS } from '@/lib/report-card'
import { fetchAll } from '@/lib/headteacher'
import { aggregate, isCore, orderSubjects } from '@/lib/master-result'
import { ordinal } from '@/lib/pdf-common'

interface Rec { student_id: string; class_id: string; subject: string; term: string; total_score: number | string | null }
interface Cls { id: string; name: string }
interface Stu { id: string; full_name: string; class_id: string }
interface Assign { subject: string; class_id: string }
interface SRow { id: string; name: string; term: string; total: number; average: number; agg: number | null; scores: Record<string, number>; subs: string[]; position: number; roll: number }
type Tab = 'class' | 'student' | 'subject' | 'subject-student'

const ROYAL = '#1E3FBF'
const GOLD = '#FFD60A'
const PASS = 50
const BANDS = [
  { label: 'A  80+', min: 80, color: '#15803d' },
  { label: 'B  70-79', min: 70, color: '#16a34a' },
  { label: 'C  60-69', min: 60, color: '#22c55e' },
  { label: 'D  50-59', min: 50, color: '#eab308' },
  { label: 'E  <50', min: -Infinity, color: '#ef4444' },
]
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const tone = (a: number) => (a >= 70 ? '#16a34a' : a >= 50 ? '#d97706' : '#dc2626')
const card = 'rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(15,31,99,0.06),0_8px_24px_-12px_rgba(15,31,99,0.18)] ring-1 ring-royal-100/70'
const select = 'rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

function stats(vals: number[]) {
  const bands = BANDS.map(() => 0)
  for (const v of vals) bands[BANDS.findIndex((b) => v >= b.min)]++
  const pass = vals.filter((v) => v >= PASS).length
  return { n: vals.length, avg: avg(vals), pass, passRate: vals.length ? (pass / vals.length) * 100 : 0, bands }
}

function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="text-xs text-gray-300">–</span>
  const d = Math.round((now - before) * 10) / 10
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-400"><Minus className="h-3 w-3" />0</span>
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${d > 0 ? 'text-green-600' : 'text-red-600'}`}>
      {d > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(d).toFixed(1)}
    </span>
  )
}

function TermBars({ values, active }: { values: (number | null)[]; active: string }) {
  return (
    <div className="flex items-end gap-3">
      {TERMS.map((t, i) => {
        const v = values[i]
        return (
          <div key={t} className="flex flex-1 flex-col items-center">
            <span className="text-xs font-bold text-royal-900">{v === null ? '–' : f1(v)}</span>
            <div className="mt-1 flex h-24 w-full items-end rounded-xl bg-slate-100">
              {v !== null && <div className="w-full rounded-xl" style={{ height: `${Math.max(4, Math.min(100, v))}%`, background: t === active ? `linear-gradient(180deg, ${GOLD}, #E6BE00)` : ROYAL, opacity: t === active ? 1 : 0.85 }} />}
            </div>
            <span className={`mt-1 text-[11px] font-semibold ${t === active ? 'text-royal-900' : 'text-gray-400'}`}>{t}</span>
          </div>
        )
      })}
    </div>
  )
}

function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color ?? tone(value) }} />
    </div>
  )
}

function BandChart({ bands, total }: { bands: number[]; total: number }) {
  return (
    <ul className="space-y-2">
      {BANDS.map((b, i) => (
        <li key={b.label} className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 font-mono text-xs text-gray-600">{b.label}</span>
          <Bar value={total ? (bands[i] / total) * 100 : 0} color={b.color} />
          <span className="w-16 text-right text-xs font-semibold text-royal-900">{bands[i]} ({total ? Math.round((bands[i] / total) * 100) : 0}%)</span>
        </li>
      ))}
    </ul>
  )
}

function Kpis({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(([k, v, sub]) => (
        <div key={k} className={card}>
          <p className="text-sm font-medium text-gray-500">{k}</p>
          <p className="mt-1 truncate text-2xl font-extrabold text-royal-900">{v}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-gray-500">{sub}</p>}
        </div>
      ))}
    </div>
  )
}

export default function TeacherPerformance() {
  const { profile } = useAuth()
  const [term, setTerm] = useState(TERMS[0])
  const [tab, setTab] = useState<Tab>('class')
  const [ready, setReady] = useState(false)
  const [myClasses, setMyClasses] = useState<Cls[]>([])
  const [assigns, setAssigns] = useState<Assign[]>([])
  const [clsNames, setClsNames] = useState<Record<string, string>>({})
  const [students, setStudents] = useState<Stu[]>([])
  const [sbaRecs, setSbaRecs] = useState<Rec[]>([])
  const [examRecs, setExamRecs] = useState<(Rec & { type: string })[]>([])
  const [exam, setExam] = useState('') // '' = overall SBA total, otherwise an exam type
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [subKey, setSubKey] = useState('') // "classId|subject"
  const [subStudentId, setSubStudentId] = useState('')

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const [{ data: cl }, { data: sa }, { data: st }] = await Promise.all([
        supabase.from('classes').select('id, name').eq('teacher_id', profile.id),
        supabase.from('subject_assignments').select('subject, class_id, class:classes(name)').eq('teacher_id', profile.id),
        supabase.from('school_settings').select('current_term').limit(1).maybeSingle(),
      ])
      if (st?.current_term && TERMS.includes(st.current_term)) setTerm(st.current_term)
      const mine = (cl ?? []) as Cls[]
      const as = ((sa ?? []) as unknown as { subject: string; class_id: string; class: { name: string } | { name: string }[] | null }[])
      const names: Record<string, string> = {}
      mine.forEach((c) => (names[c.id] = c.name))
      as.forEach((a) => { const c = Array.isArray(a.class) ? a.class[0] : a.class; if (c) names[a.class_id] = c.name })
      const ids = [...new Set([...mine.map((c) => c.id), ...as.map((a) => a.class_id)])]
      setMyClasses(mine)
      setAssigns(as.map((a) => ({ subject: a.subject, class_id: a.class_id })))
      setClsNames(names)
      if (mine[0]) { setClassId(mine[0].id); setTab('class') } else if (as[0]) setTab('subject')
      if (as[0]) setSubKey(`${as[0].class_id}|${as[0].subject}`)
      if (ids.length) {
        const [stu, rs] = await Promise.all([
          fetchAll<Stu>((a, b) => supabase.from('students').select('id, full_name, class_id').in('class_id', ids).eq('is_active', true).order('full_name').range(a, b)),
          fetchAll<Rec>((a, b) => supabase.from('sba_results').select('student_id, class_id, subject, term, total_score').in('class_id', ids).range(a, b)),
        ])
        setStudents(stu); setSbaRecs(rs)
        // Exam types: each SBA setup points at an exam session; its raw scores live in exam_scores (out of 100)
        const { data: cfg } = await supabase.from('sba_configs').select('class_id, subject, term, exam_session_id').in('class_id', ids)
        const cf = ((cfg ?? []) as { class_id: string; subject: string; term: string; exam_session_id: string | null }[]).filter((c) => c.exam_session_id)
        const sids = [...new Set(cf.map((c) => c.exam_session_id as string))]
        if (sids.length) {
          const { data: sess } = await supabase.from('exam_sessions').select('id, exam_type').in('id', sids)
          const typeOf = new Map((sess ?? []).map((x) => [x.id as string, x.exam_type as string]))
          const sc = await fetchAll<{ student_id: string; class_id: string; subject: string; exam_session_id: string; score: number | string | null }>((a, b) =>
            supabase.from('exam_scores').select('student_id, class_id, subject, exam_session_id, score').in('exam_session_id', sids).in('class_id', ids).range(a, b))
          const cfgOf = new Map(cf.map((c) => [`${c.class_id}|${c.subject}|${c.exam_session_id}`, c.term]))
          const out: (Rec & { type: string })[] = []
          for (const x of sc) {
            const t = cfgOf.get(`${x.class_id}|${x.subject}|${x.exam_session_id}`)
            const type = typeOf.get(x.exam_session_id)
            if (t && type && x.score !== null) out.push({ student_id: x.student_id, class_id: x.class_id, subject: x.subject, term: t, total_score: x.score, type })
          }
          setExamRecs(out)
        }
      }
      setReady(true)
    })()
  }, [profile])

  const isClassTeacher = myClasses.length > 0
  const isSubjectTeacher = assigns.length > 0
  const prevTerm = TERMS[TERMS.indexOf(term) - 1]

  const examTypes = useMemo(() => [...new Set(examRecs.map((e) => e.type))].sort(), [examRecs])
  const recs: Rec[] = useMemo(() => (exam ? examRecs.filter((e) => e.type === exam) : sbaRecs), [exam, examRecs, sbaRecs])

  /* class-teacher rows: whole-class totals, ranked, per term, for classes I teach */
  const classRows = useMemo(() => {
    const out: (SRow & { classId: string })[] = []
    for (const c of myClasses) {
      for (const t of TERMS) {
        const list = recs.filter((r) => r.class_id === c.id && r.term === t && r.total_score !== null)
        if (!list.length) continue
        const subs = orderSubjects([...new Set(list.map((r) => r.subject))])
        const sc = new Map<string, Record<string, number>>()
        for (const r of list) sc.set(r.student_id, { ...(sc.get(r.student_id) ?? {}), [r.subject]: Number(r.total_score) })
        const part = students.filter((s) => s.class_id === c.id).map((s) => {
          const m = sc.get(s.id) ?? {}
          const total = subs.reduce((a, x) => a + (m[x] ?? 0), 0)
          return { id: s.id, classId: c.id, name: s.full_name, term: t, total, average: total / subs.length, agg: aggregate(subs, m), scores: m, subs, position: 0, roll: 0 }
        }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        let last = -1, pos = 0
        part.forEach((r, i) => { if (r.total !== last) { pos = i + 1; last = r.total } r.position = pos; r.roll = part.length })
        out.push(...part)
      }
    }
    return out
  }, [recs, students, myClasses])

  /* subject rows: each student's score in one subject for one class/term, missing = 0 */
  const subjectRows = (cid: string, subject: string, t: string) => {
    const m = new Map<string, number>()
    for (const r of recs) if (r.class_id === cid && r.subject === subject && r.term === t && r.total_score !== null) m.set(r.student_id, Number(r.total_score))
    if (!m.size) return []
    const part = students.filter((s) => s.class_id === cid).map((s) => ({ id: s.id, name: s.full_name, score: m.get(s.id) ?? 0, position: 0 }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    let last = -1, pos = 0
    part.forEach((r, i) => { if (r.score !== last) { pos = i + 1; last = r.score } r.position = pos })
    return part
  }

  const Header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold text-royal-900">Performance</h1>
        <p className="mt-1 text-sm text-gray-500">{exam ? `Showing ${exam} exam scores (out of 100). ` : 'Showing the overall SBA total. '}Missing results count as 0.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={exam} onChange={(e) => setExam(e.target.value)} className={select} aria-label="Exam type">
          <option value="">Overall (SBA total)</option>
          {examTypes.map((t) => <option key={t} value={t}>{t} exam only</option>)}
        </select>
        <select value={term} onChange={(e) => setTerm(e.target.value)} className={select}>{TERMS.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
    </div>
  )

  if (!ready) return <Loader2 className="h-6 w-6 animate-spin text-royal-600" />
  if (!isClassTeacher && !isSubjectTeacher) return <div className="mx-auto max-w-3xl">{Header}<p className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">You have no class or subject assigned yet. Ask the admin to assign you.</p></div>

  const tabs: [Tab, string][] = [
    ...(isClassTeacher ? ([['class', 'Class performance'], ['student', 'Individual']] as [Tab, string][]) : []),
    ...(isSubjectTeacher ? ([['subject', 'Subject performance'], ['subject-student', 'Individual subject']] as [Tab, string][]) : []),
  ]

  /* ---------- class views ---------- */
  const cur = classRows.filter((r) => r.classId === classId && r.term === term).sort((a, b) => a.position - b.position)
  const prevMap = new Map(classRows.filter((r) => r.classId === classId && r.term === prevTerm).map((r) => [r.id, r]))
  const classTrend = TERMS.map((t) => { const rs = classRows.filter((r) => r.classId === classId && r.term === t); return rs.length ? avg(rs.map((r) => r.average)) : null })

  function subjectAvgList() {
    const m = new Map<string, number[]>()
    for (const r of cur) for (const s of r.subs) m.set(s, [...(m.get(s) ?? []), r.scores[s] ?? 0])
    const before = new Map<string, number>()
    const pm = new Map<string, number[]>()
    for (const r of classRows.filter((x) => x.classId === classId && x.term === prevTerm)) for (const s of r.subs) pm.set(s, [...(pm.get(s) ?? []), r.scores[s] ?? 0])
    pm.forEach((v, k) => before.set(k, avg(v)))
    return orderSubjects([...m.keys()]).map((s) => ({ s, a: avg(m.get(s)!), b: before.get(s) ?? null }))
  }

  const ClassPicker = myClasses.length > 1 ? (
    <select value={classId} onChange={(e) => setClassId(e.target.value)} className={`${select} mb-4`}>{myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
  ) : null

  function ClassView() {
    const s = stats(cur.map((r) => r.average))
    const prevAvg = prevTerm && [...prevMap.values()].length ? avg([...prevMap.values()].map((r) => r.average)) : null
    if (!cur.length) return <>{ClassPicker}<p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No saved results for this class in {term}.</p></>
    return (
      <>
        {ClassPicker}
        <Kpis items={[['Class average', f1(s.avg), prevAvg !== null ? `${prevTerm}: ${f1(prevAvg)}` : undefined], ['Pass rate', `${Math.round(s.passRate)}%`, `${s.pass} of ${s.n}`], ['Top student', cur[0].name.split(' ')[0], `average ${f1(cur[0].average)}`], ['Needs support', String(cur.filter((r) => r.average < PASS).length), 'students below 50']]} />
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section className={card}><h2 className="font-bold text-royal-900">Average by term</h2><div className="mt-4"><TermBars values={classTrend} active={term} /></div></section>
          <section className={card}><h2 className="font-bold text-royal-900">Grade bands</h2><div className="mt-4"><BandChart bands={s.bands} total={s.n} /></div></section>
          <section className={card}>
            <h2 className="font-bold text-royal-900">Subjects</h2>
            <ul className="mt-4 space-y-3">
              {subjectAvgList().map((x) => (
                <li key={x.s}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-royal-900">{x.s}{isCore(x.s) && <span className="ml-1.5 rounded bg-royal-50 px-1 text-[10px] font-bold text-royal-600">CORE</span>}</span>
                    <span className="flex items-center gap-2"><Delta now={x.a} before={x.b} /><b className="w-10 text-right text-royal-900">{f1(x.a)}</b></span>
                  </div>
                  <div className="mt-1 flex"><Bar value={x.a} /></div>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className={`${card} mt-5 overflow-x-auto`}>
          <h2 className="font-bold text-royal-900">Ranking, {term}</h2>
          <table className="mt-3 w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Pos</th><th>Student</th><th className="text-right">Total</th><th className="text-right">Average</th><th className="text-right">Agg.</th><th className="text-right">vs {prevTerm ?? 'last term'}</th><th /></tr></thead>
            <tbody>
              {cur.map((r) => (
                <tr key={r.id} onClick={() => { setStudentId(r.id); setTab('student') }} className="cursor-pointer border-t border-gray-100 hover:bg-royal-50/60">
                  <td className="py-2 font-bold text-royal-900">{r.position}</td>
                  <td className="font-medium text-royal-900">{r.name}</td>
                  <td className="text-right text-gray-600">{f1(r.total)}</td>
                  <td className="text-right font-bold" style={{ color: tone(r.average) }}>{f1(r.average)}</td>
                  <td className="text-right text-gray-600">{r.agg ?? '–'}</td>
                  <td className="text-right"><Delta now={r.average} before={prevMap.get(r.id)?.average ?? null} /></td>
                  <td className="text-right text-gray-300"><ChevronRight className="inline h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  function StudentView() {
    const list = students.filter((s) => s.class_id === classId)
    const mine = classRows.filter((r) => r.id === studentId && r.classId === classId)
    const now = mine.find((r) => r.term === term)
    const before = prevTerm ? mine.find((r) => r.term === prevTerm) : undefined
    const stu = list.find((s) => s.id === studentId)
    const classAvg = new Map<string, number>()
    for (const s of now?.subs ?? []) classAvg.set(s, avg(cur.map((r) => r.scores[s] ?? 0)))
    const subj = now ? now.subs.map((s) => ({ s, v: now.scores[s] ?? 0 })).sort((a, b) => b.v - a.v) : []
    return (
      <>
        {ClassPicker}
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={`${select} mb-4 w-full max-w-md`}>
          <option value="">Choose a student…</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        {!stu ? <p className="text-sm text-gray-500">Choose a student, or tap a name in the class ranking.</p> : (
          <>
            <section className="relative overflow-hidden rounded-3xl p-5 text-white" style={{ background: `linear-gradient(120deg, ${ROYAL}, #0F1F63)` }}>
              <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: GOLD }} />
              <h2 className="text-xl font-extrabold">{stu.full_name}</h2>
              <p className="text-sm text-blue-100">{clsNames[stu.class_id]} · {term}</p>
              {now ? (
                <div className="mt-3 flex flex-wrap gap-6">
                  {[['Average', f1(now.average)], ['Total', f1(now.total)], ['Position', `${ordinal(now.position)} of ${now.roll}`], ['Aggregate', now.agg === null ? '–' : String(now.agg)]].map(([k, v]) => (
                    <div key={k}><p className="text-[11px] uppercase tracking-wider text-blue-100">{k}</p><p className="text-xl font-extrabold" style={{ color: GOLD }}>{v}</p></div>
                  ))}
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">vs {prevTerm ?? 'last term'}</p><p className="text-xl font-extrabold"><Delta now={now.average} before={before?.average ?? null} /></p></div>
                </div>
              ) : <p className="mt-3 text-sm text-blue-100">No saved results for this student in {term}.</p>}
            </section>
            {now && (
              <div className="mt-5 grid gap-5 lg:grid-cols-3">
                <section className={card}>
                  <h2 className="font-bold text-royal-900">Average by term</h2>
                  <div className="mt-4"><TermBars values={TERMS.map((t) => mine.find((r) => r.term === t)?.average ?? null)} active={term} /></div>
                  <p className="mt-3 text-xs text-gray-500">Position: {TERMS.map((t) => { const r = mine.find((x) => x.term === t); return `${t.replace('Term ', 'T')} ${r ? ordinal(r.position) : '–'}` }).join(' · ')}</p>
                </section>
                <section className={card}>
                  <h2 className="font-bold text-royal-900">Strengths</h2>
                  <ul className="mt-3 space-y-2 text-sm">{subj.slice(0, 3).map((x) => <li key={x.s} className="flex justify-between"><span className="text-royal-900">{x.s}</span><b className="text-green-600">{f1(x.v)}</b></li>)}</ul>
                  <h2 className="mt-5 font-bold text-royal-900">Needs support</h2>
                  <ul className="mt-3 space-y-2 text-sm">{[...subj].reverse().slice(0, 3).map((x) => <li key={x.s} className="flex justify-between"><span className="text-royal-900">{x.s}</span><b style={{ color: tone(x.v) }}>{f1(x.v)}</b></li>)}</ul>
                </section>
                <section className={`${card} overflow-x-auto`}>
                  <h2 className="font-bold text-royal-900">Subject scores</h2>
                  <table className="mt-3 w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500"><tr><th className="py-1">Subject</th>{TERMS.map((t) => <th key={t} className="text-right">{t.replace('Term ', 'T')}</th>)}<th className="text-right">Class</th></tr></thead>
                    <tbody>
                      {now.subs.map((s) => (
                        <tr key={s} className="border-t border-gray-100">
                          <td className="py-1.5 font-medium text-royal-900">{s}</td>
                          {TERMS.map((t) => { const r = mine.find((x) => x.term === t); const v = r && r.subs.includes(s) ? (r.scores[s] ?? 0) : null; return <td key={t} className={`text-right ${t === term ? 'font-bold' : 'text-gray-500'}`} style={t === term && v !== null ? { color: tone(v) } : undefined}>{v === null ? '–' : f1(v)}</td> })}
                          <td className="text-right text-gray-400">{f1(classAvg.get(s) ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            )}
          </>
        )}
      </>
    )
  }

  /* ---------- subject views ---------- */
  const [subCid, subject] = subKey.split('|')
  const SubPicker = (
    <select value={subKey} onChange={(e) => setSubKey(e.target.value)} className={`${select} mb-4`}>
      {assigns.map((a) => <option key={`${a.class_id}|${a.subject}`} value={`${a.class_id}|${a.subject}`}>{a.subject} · {clsNames[a.class_id]}</option>)}
    </select>
  )

  function SubjectView() {
    const rows = subjectRows(subCid, subject, term)
    const before = new Map(subjectRows(subCid, subject, prevTerm ?? '').map((r) => [r.id, r.score]))
    const s = stats(rows.map((r) => r.score))
    const trend = TERMS.map((t) => { const r = subjectRows(subCid, subject, t); return r.length ? avg(r.map((x) => x.score)) : null })
    const prevAvg = prevTerm && before.size ? avg([...before.values()]) : null
    if (!rows.length) return <>{SubPicker}<p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No saved {subject} results for {clsNames[subCid]} in {term}.</p></>
    return (
      <>
        {SubPicker}
        <Kpis items={[['Subject average', f1(s.avg), prevAvg !== null ? `${prevTerm}: ${f1(prevAvg)}` : undefined], ['Pass rate', `${Math.round(s.passRate)}%`, `${s.pass} of ${s.n} at 50+`], ['Highest', f1(rows[0].score), rows[0].name], ['Lowest', f1(rows[rows.length - 1].score), rows[rows.length - 1].name]]} />
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className={card}><h2 className="font-bold text-royal-900">Average by term</h2><div className="mt-4"><TermBars values={trend} active={term} /></div></section>
          <section className={card}><h2 className="font-bold text-royal-900">Grade bands</h2><div className="mt-4"><BandChart bands={s.bands} total={s.n} /></div></section>
        </div>
        <section className={`${card} mt-5 overflow-x-auto`}>
          <h2 className="font-bold text-royal-900">{subject} ranking, {term}</h2>
          <table className="mt-3 w-full min-w-[420px] text-left text-sm">
            <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Pos</th><th>Student</th><th className="text-right">Score</th><th className="text-right">vs {prevTerm ?? 'last term'}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => { setSubStudentId(r.id); setTab('subject-student') }} className="cursor-pointer border-t border-gray-100 hover:bg-royal-50/60">
                  <td className="py-2 font-bold text-royal-900">{r.position}</td>
                  <td className="font-medium text-royal-900">{r.name}</td>
                  <td className="text-right font-bold" style={{ color: tone(r.score) }}>{f1(r.score)}</td>
                  <td className="text-right"><Delta now={r.score} before={before.has(r.id) ? before.get(r.id)! : null} /></td>
                  <td className="text-right text-gray-300"><ChevronRight className="inline h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  function SubjectStudentView() {
    const list = students.filter((s) => s.class_id === subCid)
    const stu = list.find((s) => s.id === subStudentId)
    const per = TERMS.map((t) => subjectRows(subCid, subject, t))
    const mineT = per.map((rows) => rows.find((r) => r.id === subStudentId) ?? null)
    const idx = TERMS.indexOf(term)
    const now = mineT[idx]
    const before = prevTerm ? mineT[idx - 1] : null
    return (
      <>
        {SubPicker}
        <select value={subStudentId} onChange={(e) => setSubStudentId(e.target.value)} className={`${select} mb-4 w-full max-w-md`}>
          <option value="">Choose a student…</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        {!stu ? <p className="text-sm text-gray-500">Choose a student, or tap a name in the subject ranking.</p> : (
          <>
            <section className="relative overflow-hidden rounded-3xl p-5 text-white" style={{ background: `linear-gradient(120deg, ${ROYAL}, #0F1F63)` }}>
              <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: GOLD }} />
              <h2 className="text-xl font-extrabold">{stu.full_name}</h2>
              <p className="text-sm text-blue-100">{subject} · {clsNames[subCid]} · {term}</p>
              {now ? (
                <div className="mt-3 flex flex-wrap gap-6">
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">Score</p><p className="text-xl font-extrabold" style={{ color: GOLD }}>{f1(now.score)}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">Position</p><p className="text-xl font-extrabold" style={{ color: GOLD }}>{ordinal(now.position)} of {per[idx].length}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">Class average</p><p className="text-xl font-extrabold" style={{ color: GOLD }}>{f1(avg(per[idx].map((r) => r.score)))}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">vs {prevTerm ?? 'last term'}</p><p className="text-xl font-extrabold"><Delta now={now.score} before={before?.score ?? null} /></p></div>
                </div>
              ) : <p className="mt-3 text-sm text-blue-100">No saved {subject} result in {term}.</p>}
            </section>
            <section className={`${card} mt-5`}>
              <h2 className="font-bold text-royal-900">{subject} by term</h2>
              <div className="mt-4 max-w-md"><TermBars values={mineT.map((r) => r?.score ?? null)} active={term} /></div>
              <p className="mt-3 text-xs text-gray-500">Class average: {TERMS.map((t, i) => `${t.replace('Term ', 'T')} ${per[i].length ? f1(avg(per[i].map((r) => r.score))) : '–'}`).join(' · ')}</p>
            </section>
          </>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      {Header}
      <div className="mt-4 inline-flex flex-wrap rounded-2xl bg-white p-1 shadow-sm ring-1 ring-gray-200">
        {tabs.map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === v ? 'text-royal-900' : 'text-gray-500 hover:text-royal-700'}`} style={tab === v ? { background: GOLD } : undefined}>{label}</button>
        ))}
      </div>
      <div className="mt-5">{tab === 'class' ? ClassView() : tab === 'student' ? StudentView() : tab === 'subject' ? SubjectView() : SubjectStudentView()}</div>
    </div>
  )
}