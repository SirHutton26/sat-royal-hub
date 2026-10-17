import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Loader2, Minus, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TERMS } from '@/lib/report-card'
import { fetchAll } from '@/lib/headteacher'
import { aggregate, isCore, orderSubjects } from '@/lib/master-result'
import { ordinal } from '@/lib/pdf-common'

/* ---------- types ---------- */
interface Rec { student_id: string; class_id: string; subject: string; term: string; total_score: number | string | null }
interface Cls { id: string; name: string; level_group: string | null }
interface Stu { id: string; full_name: string; class_id: string }
interface SRow {
  id: string
  name: string
  classId: string
  term: string
  total: number
  average: number
  agg: number | null
  scores: Record<string, number>
  subs: string[]
  position: number
  roll: number
}
type View = 'school' | 'level' | 'class' | 'student'

const ROYAL = '#1E3FBF'
const GOLD = '#FFD60A'
const PASS = 50
const LEVELS: Record<string, string> = { creche: 'Creche', nursery: 'Nursery', kg: 'KG', lower_primary: 'Lower Primary', upper_primary: 'Upper Primary', jhs: 'JHS' }
const LEVEL_ORDER = Object.keys(LEVELS)
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

function summarise(rows: SRow[]) {
  const n = rows.length
  const bands = BANDS.map(() => 0)
  for (const r of rows) bands[BANDS.findIndex((b) => r.average >= b.min)]++
  const pass = rows.filter((r) => r.average >= PASS).length
  return { n, avg: avg(rows.map((r) => r.average)), pass, passRate: n ? (pass / n) * 100 : 0, bands }
}

/** Average of each subject over everyone who sat it (a missing score counts as 0) */
function subjectAvgs(rows: SRow[]) {
  const m = new Map<string, number[]>()
  for (const r of rows) for (const s of r.subs) m.set(s, [...(m.get(s) ?? []), r.scores[s] ?? 0])
  return orderSubjects([...m.keys()]).map((subject) => ({ subject, average: avg(m.get(subject)!), n: m.get(subject)!.length }))
}

/* ---------- small pieces ---------- */
function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="text-xs text-gray-300">–</span>
  const d = Math.round((now - before) * 10) / 10
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-400"><Minus className="h-3 w-3" />0</span>
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-green-600' : 'text-red-600'}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d).toFixed(1)}
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
              {v !== null && <div className="w-full rounded-xl transition-all" style={{ height: `${Math.max(4, Math.min(100, v))}%`, background: t === active ? `linear-gradient(180deg, ${GOLD}, #E6BE00)` : ROYAL, opacity: t === active ? 1 : 0.85 }} />}
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

const card = 'rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(15,31,99,0.06),0_8px_24px_-12px_rgba(15,31,99,0.18)] ring-1 ring-royal-100/70'
const select = 'rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

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

function SubjectList({ rows, prevRows }: { rows: SRow[]; prevRows?: SRow[] }) {
  const now = subjectAvgs(rows)
  const before = new Map(subjectAvgs(prevRows ?? []).map((s) => [s.subject, s.average]))
  if (!now.length) return <p className="text-sm text-gray-500">No subject results yet.</p>
  return (
    <ul className="space-y-3">
      {now.map((s) => (
        <li key={s.subject}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-royal-900">{s.subject}{isCore(s.subject) && <span className="ml-1.5 rounded bg-royal-50 px-1 text-[10px] font-bold text-royal-600">CORE</span>}</span>
            <span className="flex items-center gap-2"><Delta now={s.average} before={before.get(s.subject) ?? null} /><b className="w-10 text-right text-royal-900">{f1(s.average)}</b></span>
          </div>
          <div className="mt-1 flex"><Bar value={s.average} /></div>
        </li>
      ))}
    </ul>
  )
}

/* ---------- page ---------- */
export default function HeadteacherPerformance() {
  const [term, setTerm] = useState(TERMS[0])
  const [view, setView] = useState<View>('school')
  const [level, setLevel] = useState('')
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [q, setQ] = useState('')
  const [classes, setClasses] = useState<Cls[]>([])
  const [students, setStudents] = useState<Stu[]>([])
  const [recs, setRecs] = useState<Rec[] | null>(null)

  useEffect(() => {
    supabase.from('school_settings').select('current_term').limit(1).maybeSingle().then(({ data }) => {
      if (data?.current_term && TERMS.includes(data.current_term)) setTerm(data.current_term)
    })
    supabase.from('classes').select('id, name, level_group').order('name').then(({ data }) => setClasses((data ?? []) as Cls[]))
    fetchAll<Stu>((a, b) => supabase.from('students').select('id, full_name, class_id').eq('is_active', true).order('full_name').range(a, b)).then(setStudents)
    fetchAll<Rec>((a, b) => supabase.from('sba_results').select('student_id, class_id, subject, term, total_score').range(a, b)).then(setRecs)
  }, [])

  /** Every student's totals, average, aggregate and position, for every term */
  const rows = useMemo(() => {
    if (!recs) return null
    const stuById = new Map(students.map((s) => [s.id, s]))
    const groups = new Map<string, Rec[]>()
    for (const r of recs) {
      if (r.total_score === null) continue
      const k = `${r.term}|${r.class_id}`
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    const out: SRow[] = []
    for (const [k, list] of groups) {
      const [t, cid] = k.split('|')
      const subs = orderSubjects([...new Set(list.map((r) => r.subject))])
      const scoreOf = new Map<string, Record<string, number>>()
      for (const r of list) scoreOf.set(r.student_id, { ...(scoreOf.get(r.student_id) ?? {}), [r.subject]: Number(r.total_score) })
      const roll = new Set<string>([...students.filter((s) => s.class_id === cid).map((s) => s.id), ...scoreOf.keys()])
      const part: SRow[] = [...roll]
        .filter((id) => stuById.has(id))
        .map((id) => {
          const sc = scoreOf.get(id) ?? {}
          const total = subs.reduce((a, s) => a + (sc[s] ?? 0), 0)
          return { id, name: stuById.get(id)!.full_name, classId: cid, term: t, total, average: total / subs.length, agg: aggregate(subs, sc), scores: sc, subs, position: 0, roll: 0 }
        })
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      let last = -1
      let pos = 0
      part.forEach((r, i) => {
        if (r.total !== last) {
          pos = i + 1
          last = r.total
        }
        r.position = pos
        r.roll = part.length
      })
      out.push(...part)
    }
    return out
  }, [recs, students])

  const prevTerm = TERMS[TERMS.indexOf(term) - 1]
  const clsOf = (id: string) => classes.find((c) => c.id === id)
  const inTerm = (t: string) => (rows ?? []).filter((r) => r.term === t)
  const cur = inTerm(term)
  const prev = prevTerm ? inTerm(prevTerm) : []

  const levelOf = (classId: string) => clsOf(classId)?.level_group ?? ''
  const inLevel = (rs: SRow[], lv: string) => rs.filter((r) => levelOf(r.classId) === lv)
  const inClass = (rs: SRow[], id: string) => rs.filter((r) => r.classId === id)
  const trend = (pick: (rs: SRow[]) => SRow[]) => TERMS.map((t) => { const rs = pick(inTerm(t)); return rs.length ? summarise(rs).avg : null })

  const levels = LEVEL_ORDER.filter((l) => classes.some((c) => c.level_group === l))
  const levelClasses = classes.filter((c) => c.level_group === level)

  const go = (v: View, patch: { level?: string; classId?: string; studentId?: string } = {}) => {
    if (patch.level !== undefined) setLevel(patch.level)
    if (patch.classId !== undefined) setClassId(patch.classId)
    if (patch.studentId !== undefined) setStudentId(patch.studentId)
    setView(v)
  }

  const tabs: [View, string][] = [['school', 'Whole school'], ['level', 'Level'], ['class', 'Class'], ['student', 'Student']]

  /* ---------- views ---------- */
  function SchoolView() {
    const s = summarise(cur)
    const sp = summarise(prev)
    const byClass = classes.map((c) => ({ c, s: summarise(inClass(cur, c.id)) })).filter((x) => x.s.n)
    const best = [...byClass].sort((a, b) => b.s.avg - a.s.avg)[0]
    const weak = [...byClass].sort((a, b) => a.s.avg - b.s.avg)[0]
    return (
      <>
        <Kpis items={[
          ['School average', s.n ? f1(s.avg) : '–', prev.length ? `${prevTerm}: ${f1(sp.avg)}` : undefined],
          ['Pass rate', s.n ? `${Math.round(s.passRate)}%` : '–', `${s.pass} of ${s.n} students at 50+`],
          ['Strongest class', best?.c.name ?? '–', best ? `average ${f1(best.s.avg)}` : undefined],
          ['Needs most support', weak?.c.name ?? '–', weak ? `average ${f1(weak.s.avg)}` : undefined],
        ]} />
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section className={card}>
            <h2 className="font-bold text-royal-900">School average by term</h2>
            <div className="mt-4"><TermBars values={trend((x) => x)} active={term} /></div>
          </section>
          <section className={card}>
            <h2 className="font-bold text-royal-900">Grade bands</h2>
            <div className="mt-4"><BandChart bands={s.bands} total={s.n} /></div>
          </section>
          <section className={card}>
            <h2 className="font-bold text-royal-900">Subjects across the school</h2>
            <div className="mt-4"><SubjectList rows={cur} prevRows={prev} /></div>
          </section>
        </div>
        <section className={`${card} mt-5 overflow-x-auto`}>
          <h2 className="font-bold text-royal-900">Levels</h2>
          <table className="mt-3 w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Level</th><th className="text-right">Students</th><th className="text-right">Average</th><th className="text-right">Pass rate</th><th className="text-right">vs {prevTerm ?? 'last term'}</th><th /></tr></thead>
            <tbody>
              {levels.map((l) => {
                const a = summarise(inLevel(cur, l))
                const b = summarise(inLevel(prev, l))
                return (
                  <tr key={l} onClick={() => go('level', { level: l })} className="cursor-pointer border-t border-gray-100 hover:bg-royal-50/60">
                    <td className="py-2.5 font-semibold text-royal-900">{LEVELS[l]}</td>
                    <td className="text-right text-gray-600">{a.n || '–'}</td>
                    <td className="text-right font-bold" style={{ color: a.n ? tone(a.avg) : undefined }}>{a.n ? f1(a.avg) : '–'}</td>
                    <td className="text-right text-gray-600">{a.n ? `${Math.round(a.passRate)}%` : '–'}</td>
                    <td className="text-right"><Delta now={a.n ? a.avg : null} before={b.n ? b.avg : null} /></td>
                    <td className="text-right text-gray-300"><ChevronRight className="inline h-4 w-4" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  function LevelView() {
    const rs = inLevel(cur, level)
    const s = summarise(rs)
    return (
      <>
        <div className="mb-4 flex flex-wrap gap-2">
          {levels.map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${level === l ? 'bg-royal-700 text-white' : 'bg-white text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50'}`}>{LEVELS[l]}</button>
          ))}
        </div>
        {!level ? <p className="text-sm text-gray-500">Choose a level above.</p> : !rs.length ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No saved results for {LEVELS[level]} in {term}.</p> : (
          <>
            <Kpis items={[['Level average', f1(s.avg), prevTerm ? `${prevTerm}: ${inLevel(prev, level).length ? f1(summarise(inLevel(prev, level)).avg) : '–'}` : undefined], ['Pass rate', `${Math.round(s.passRate)}%`, `${s.pass} of ${s.n}`], ['Students', String(s.n), `${levelClasses.length} classes`], ['Top score', f1(Math.max(...rs.map((r) => r.average))), [...rs].sort((a, b) => b.average - a.average)[0].name]]} />
            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              <section className={card}><h2 className="font-bold text-royal-900">Average by term</h2><div className="mt-4"><TermBars values={trend((x) => inLevel(x, level))} active={term} /></div></section>
              <section className={card}><h2 className="font-bold text-royal-900">Grade bands</h2><div className="mt-4"><BandChart bands={s.bands} total={s.n} /></div></section>
              <section className={card}><h2 className="font-bold text-royal-900">Subjects</h2><div className="mt-4"><SubjectList rows={rs} prevRows={inLevel(prev, level)} /></div></section>
            </div>
            <section className={`${card} mt-5 overflow-x-auto`}>
              <h2 className="font-bold text-royal-900">Classes in {LEVELS[level]}</h2>
              <table className="mt-3 w-full min-w-[480px] text-left text-sm">
                <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Class</th><th className="text-right">Students</th><th className="text-right">Average</th><th className="text-right">Pass rate</th><th className="text-right">vs {prevTerm ?? 'last term'}</th><th /></tr></thead>
                <tbody>
                  {levelClasses.map((c) => {
                    const a = summarise(inClass(cur, c.id))
                    const b = summarise(inClass(prev, c.id))
                    return (
                      <tr key={c.id} onClick={() => a.n && go('class', { classId: c.id })} className={`border-t border-gray-100 ${a.n ? 'cursor-pointer hover:bg-royal-50/60' : ''}`}>
                        <td className="py-2.5 font-semibold text-royal-900">{c.name}</td>
                        <td className="text-right text-gray-600">{a.n || '–'}</td>
                        <td className="text-right font-bold" style={{ color: a.n ? tone(a.avg) : undefined }}>{a.n ? f1(a.avg) : 'no results'}</td>
                        <td className="text-right text-gray-600">{a.n ? `${Math.round(a.passRate)}%` : '–'}</td>
                        <td className="text-right"><Delta now={a.n ? a.avg : null} before={b.n ? b.avg : null} /></td>
                        <td className="text-right text-gray-300">{a.n ? <ChevronRight className="inline h-4 w-4" /> : null}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </>
    )
  }

  function ClassView() {
    const rs = inClass(cur, classId).sort((a, b) => a.position - b.position)
    const pv = new Map(inClass(prev, classId).map((r) => [r.id, r]))
    const s = summarise(rs)
    return (
      <>
        <div className="mb-4">
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={select}>
            <option value="">Choose a class…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!classId ? <p className="text-sm text-gray-500">Choose a class above.</p> : !rs.length ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No saved results for this class in {term}.</p> : (
          <>
            <Kpis items={[['Class average', f1(s.avg), inClass(prev, classId).length ? `${prevTerm}: ${f1(summarise(inClass(prev, classId)).avg)}` : undefined], ['Pass rate', `${Math.round(s.passRate)}%`, `${s.pass} of ${s.n}`], ['Top student', rs[0].name.split(' ')[0], `average ${f1(rs[0].average)}`], ['Needs support', String(rs.filter((r) => r.average < PASS).length), 'students below 50']]} />
            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              <section className={card}><h2 className="font-bold text-royal-900">Average by term</h2><div className="mt-4"><TermBars values={trend((x) => inClass(x, classId))} active={term} /></div></section>
              <section className={card}><h2 className="font-bold text-royal-900">Grade bands</h2><div className="mt-4"><BandChart bands={s.bands} total={s.n} /></div></section>
              <section className={card}><h2 className="font-bold text-royal-900">Subjects</h2><div className="mt-4"><SubjectList rows={rs} prevRows={inClass(prev, classId)} /></div></section>
            </div>
            <section className={`${card} mt-5 overflow-x-auto`}>
              <h2 className="font-bold text-royal-900">Ranking, {term}</h2>
              <table className="mt-3 w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Pos</th><th>Student</th><th className="text-right">Total</th><th className="text-right">Average</th><th className="text-right">Agg.</th><th className="text-right">vs {prevTerm ?? 'last term'}</th><th /></tr></thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.id} onClick={() => go('student', { studentId: r.id, classId })} className="cursor-pointer border-t border-gray-100 hover:bg-royal-50/60">
                      <td className="py-2 font-bold text-royal-900">{r.position}</td>
                      <td className="font-medium text-royal-900">{r.name}</td>
                      <td className="text-right text-gray-600">{f1(r.total)}</td>
                      <td className="text-right font-bold" style={{ color: tone(r.average) }}>{f1(r.average)}</td>
                      <td className="text-right text-gray-600">{r.agg ?? '–'}</td>
                      <td className="text-right"><Delta now={r.average} before={pv.get(r.id)?.average ?? null} /></td>
                      <td className="text-right text-gray-300"><ChevronRight className="inline h-4 w-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </>
    )
  }

  function StudentView() {
    const matches = q.trim().length >= 2 ? students.filter((s) => s.full_name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
    const mine = (rows ?? []).filter((r) => r.id === studentId)
    const now = mine.find((r) => r.term === term)
    const before = prevTerm ? mine.find((r) => r.term === prevTerm) : undefined
    const stu = students.find((s) => s.id === studentId)
    const classRows = now ? inClass(cur, now.classId) : []
    const classAvg = new Map(subjectAvgs(classRows).map((s) => [s.subject, s.average]))
    const subj = now ? now.subs.map((s) => ({ s, v: now.scores[s] ?? 0 })).sort((a, b) => b.v - a.v) : []
    return (
      <>
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a student by name…" className={`${select} w-full pl-9`} />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-gray-200">
              {matches.map((m) => (
                <li key={m.id}>
                  <button onClick={() => { go('student', { studentId: m.id, classId: m.class_id }); setQ('') }} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-royal-50">
                    <span className="font-medium text-royal-900">{m.full_name}</span><span className="text-xs text-gray-400">{clsOf(m.class_id)?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!stu ? <p className="text-sm text-gray-500">Search for a student, or tap a name in a class ranking.</p> : (
          <>
            <section className="relative overflow-hidden rounded-3xl p-5 text-white" style={{ background: `linear-gradient(120deg, ${ROYAL}, #0F1F63)` }}>
              <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: GOLD }} />
              <h2 className="text-xl font-extrabold">{stu.full_name}</h2>
              <p className="text-sm text-blue-100">{clsOf(stu.class_id)?.name} · {term}</p>
              {now ? (
                <div className="mt-3 flex flex-wrap gap-6">
                  {[['Average', f1(now.average)], ['Total', f1(now.total)], ['Position', `${ordinal(now.position)} of ${now.roll}`], ['Aggregate', now.agg === null ? '–' : String(now.agg)]].map(([k, v]) => (
                    <div key={k}><p className="text-[11px] uppercase tracking-wider text-blue-100">{k}</p><p className="text-xl font-extrabold" style={{ color: GOLD }}>{v}</p></div>
                  ))}
                  <div><p className="text-[11px] uppercase tracking-wider text-blue-100">vs {prevTerm ?? 'last term'}</p><p className="text-xl font-extrabold text-white"><Delta now={now.average} before={before?.average ?? null} /></p></div>
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
                          <td className="text-right text-gray-400">{classAvg.has(s) ? f1(classAvg.get(s)!) : '–'}</td>
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-royal-900">Performance</h1>
          <p className="mt-1 text-sm text-gray-500">The whole school, a level, a class or one student, term by term. Missing results count as 0.</p>
        </div>
        <select value={term} onChange={(e) => setTerm(e.target.value)} className={select}>{TERMS.map((t) => <option key={t}>{t}</option>)}</select>
      </div>

      <div className="mt-4 inline-flex rounded-2xl bg-white p-1 shadow-sm ring-1 ring-gray-200">
        {tabs.map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${view === v ? 'text-royal-900' : 'text-gray-500 hover:text-royal-700'}`} style={view === v ? { background: GOLD } : undefined}>{label}</button>
        ))}
      </div>

      <div className="mt-5">
        {!rows ? <Loader2 className="h-6 w-6 animate-spin text-royal-600" /> : view === 'school' ? SchoolView() : view === 'level' ? LevelView() : view === 'class' ? ClassView() : StudentView()}
      </div>
    </div>
  )
}