import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'

export interface ReportRow {
  studentId: string
  name: string
  scores: Record<string, number | null>
  complete: boolean
  total: number | null
  average: number | null
  position: number | null
}

interface Props {
  classLabel: string
  term: string
  subjects: string[]
  missingSubjects: string[]
  rows: ReportRow[]
  onClose: () => void
}

interface SubjectStat {
  name: string
  scored: number
  average: number
  highest: number
  lowest: number
  pass: number
  passRate: number
}

const PASS_MARK = 50
const ROWS_PER_PAGE = 40
const SCHOOL_TITLE = 'Sat Royal Basic School'

// Report bands (same as the class performance report)
const BANDS = [
  { range: 'A (80-100%)', label: 'Excellent', min: 80, color: '#15803d' },
  { range: 'B (70-79%)', label: 'Very Good', min: 70, color: '#16a34a' },
  { range: 'C (60-69%)', label: 'Good', min: 60, color: '#22c55e' },
  { range: 'D (50-59%)', label: 'Pass', min: 50, color: '#eab308' },
  { range: 'E/F (<50%)', label: 'Below Avg', min: -Infinity, color: '#ef4444' },
]

const ABBREVIATIONS: Record<string, string> = {
  english: 'Eng',
  'english language': 'Eng',
  maths: 'Math',
  mathematics: 'Math',
  science: 'Sci',
  'integrated science': 'Sci',
  'creative art': 'Art',
  'creative arts': 'Art',
  'creative arts and design': 'Art',
  rme: 'RME',
  'religious and moral education': 'RME',
  'religious & moral education': 'RME',
  history: 'Hist',
  computing: 'Comp',
  'ga/dangme': 'Ga',
  ga: 'Ga',
  'social studies': 'Soc',
  french: 'Fre',
}

const REPORT_CSS = `
.mr-page { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 12mm; margin: 0 auto 8mm; background: #fff; color: #0f172a; display: flex; flex-direction: column; box-shadow: 0 2px 14px rgba(15,23,42,0.2); font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.mr-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4; margin: 0; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#mr-print-root) { display: none !important; }
  #mr-print-root { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; background: #fff !important; }
  .mr-noprint { display: none !important; }
  .mr-zoom { zoom: 1 !important; padding: 0 !important; }
  .mr-page { margin: 0 !important; box-shadow: none !important; min-height: 295mm; break-after: page; page-break-after: always; }
  .mr-page:last-child { break-after: auto; page-break-after: auto; }
  .mr-page tr { break-inside: avoid; page-break-inside: avoid; }
}
`

function ordinal(n: number) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function abbreviate(name: string): string {
  const key = name.trim().toLowerCase()
  if (ABBREVIATIONS[key]) return ABBREVIATIONS[key]
  const words = name.trim().split(/\s+/)
  if (words.length >= 3) return words.map((w) => w[0]).join('').toUpperCase().slice(0, 5)
  return name.length <= 5 ? name : name.slice(0, 4)
}

function shortLabel(name: string): string {
  return name.length <= 14 ? name : abbreviate(name)
}

function namesLabel(names: string[]): string {
  if (names.length <= 2) return names.join(' & ')
  return `${names[0]}, ${names[1]} +${names.length - 2} more`
}

function categoryFor(avg: number): { label: string; cls: string } {
  if (avg < 50) return { label: 'Critical Need', cls: 'bg-red-100 text-red-700' }
  if (avg < 60) return { label: 'Satisfactory', cls: 'bg-amber-100 text-amber-700' }
  if (avg < 70) return { label: 'Good', cls: 'bg-sky-100 text-sky-700' }
  return { label: 'Excellent', cls: 'bg-green-100 text-green-700' }
}

function termInfo(term: string) {
  const n = parseInt(term.replace(/\D/g, ''), 10)
  if (!n) return { label: term, next: 'the next term' }
  return { label: `End of ${ordinal(n)} Term`, next: n >= 3 ? 'Term 1 (Next Academic Year)' : `Term ${n + 1}` }
}

function buildReport(subjects: string[], missing: string[], rows: ReportRow[]) {
  const active = subjects.filter((s) => !missing.includes(s))

  const subjectStats: SubjectStat[] = active
    .map((name) => {
      const vals = rows.map((r) => r.scores[name]).filter((v): v is number => v !== null && v !== undefined)
      const pass = vals.filter((v) => v >= PASS_MARK).length
      return {
        name,
        scored: vals.length,
        average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
        highest: vals.length ? Math.max(...vals) : 0,
        lowest: vals.length ? Math.min(...vals) : 0,
        pass,
        passRate: vals.length ? (pass / vals.length) * 100 : 0,
      }
    })
    .filter((s) => s.scored > 0)

  const ranked = rows.filter((r) => r.total !== null && r.average !== null)
  const completeCount = ranked.length
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
  const totals = ranked.map((r) => r.total as number)
  const averages = ranked.map((r) => r.average as number)

  const topTotal = completeCount ? Math.max(...totals) : 0
  const lowTotal = completeCount ? Math.min(...totals) : 0
  const passCount = averages.filter((a) => a >= PASS_MARK).length

  const bandCounts = BANDS.map(() => 0)
  for (const a of averages) bandCounts[BANDS.findIndex((b) => a >= b.min)]++

  const sheetRows = [...rows].sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position || a.name.localeCompare(b.name)
    if (a.position !== null) return -1
    if (b.position !== null) return 1
    return a.name.localeCompare(b.name)
  })

  return {
    active,
    subjectStats,
    completeCount,
    meanTotal: completeCount ? sum(totals) / completeCount : 0,
    classAverage: completeCount ? sum(averages) / completeCount : 0,
    maxPossible: active.length * 100,
    topTotal,
    lowTotal,
    toppers: ranked.filter((r) => r.total === topTotal),
    bottoms: ranked.filter((r) => r.total === lowTotal),
    passCount,
    passRate: completeCount ? (passCount / completeCount) * 100 : 0,
    bandCounts,
    sheetRows,
    byAverage: [...subjectStats].sort((a, b) => b.average - a.average),
  }
}

function useFitScale(pagePx = 794) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const update = () => setScale(Math.min(1, (window.innerWidth - 16) / pagePx))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [pagePx])
  return scale
}

function SubjectBars({ stats }: { stats: SubjectStat[] }) {
  const W = 460
  const left = 90
  const right = 40
  const top = 26
  const bottom = 34
  const rowH = 20
  const H = top + bottom + stats.length * rowH
  const plotW = W - left - right
  const x = (v: number) => left + (v / 100) * plotW

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Subject performance benchmarks">
      <text x={W / 2} y={14} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
        Subject Performance Benchmarks
      </text>
      {[0, 20, 40, 60, 80, 100].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={H - bottom} stroke="#e2e8f0" strokeWidth="0.6" />
          <text x={x(t)} y={H - bottom + 11} textAnchor="middle" fontSize="8" fill="#475569">
            {t}
          </text>
        </g>
      ))}
      <text x={left + plotW / 2} y={H - 6} textAnchor="middle" fontSize="8" fontWeight="700" fill="#334155">
        Class Average Score (%)
      </text>
      {stats.map((s, i) => {
        const y = top + i * rowH
        const color = s.average >= 60 ? '#16a34a' : s.average >= 50 ? '#d97706' : '#dc2626'
        return (
          <g key={s.name}>
            <text x={left - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="8.5" fill="#334155">
              {shortLabel(s.name)}
            </text>
            <rect x={left} y={y + 3} width={Math.max(0, x(s.average) - left)} height={rowH - 6} fill={color} rx="1" />
            <text x={x(s.average) + 4} y={y + rowH / 2 + 3} fontSize="7.5" fontWeight="600" fill="#334155">
              {s.average.toFixed(1)}%
            </text>
          </g>
        )
      })}
      <line x1={x(50)} x2={x(50)} y1={top} y2={H - bottom} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
      <line x1={W - right - 92} x2={W - right - 78} y1={H - bottom - 8} y2={H - bottom - 8} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
      <text x={W - right - 74} y={H - bottom - 5} fontSize="7" fill="#475569">
        Pass Threshold (50%)
      </text>
    </svg>
  )
}

function BandChart({ counts, total }: { counts: number[]; total: number }) {
  const W = 460
  const H = 230
  const left = 38
  const right = 12
  const top = 30
  const bottom = 44
  const plotW = W - left - right
  const plotH = H - top - bottom
  const yMax = Math.ceil(Math.max(5, ...counts) / 5) * 5
  const ticks: number[] = []
  for (let t = 0; t <= yMax; t += 5) ticks.push(t)
  const slot = plotW / BANDS.length
  const barW = slot * 0.5
  const y = (v: number) => top + plotH - (v / yMax) * plotH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Overall academic band distribution">
      <text x={W / 2} y={14} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
        Overall Academic Band Distribution ({total} Students)
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="0.6" />
          <text x={left - 5} y={y(t) + 3} textAnchor="end" fontSize="8" fill="#475569">
            {t}
          </text>
        </g>
      ))}
      <text x={10} y={top + plotH / 2} transform={`rotate(-90 10 ${top + plotH / 2})`} textAnchor="middle" fontSize="8" fontWeight="700" fill="#334155">
        Number of Students
      </text>
      {BANDS.map((b, i) => {
        const cx = left + slot * i + slot / 2
        const count = counts[i]
        const pct = total ? ((count / total) * 100).toFixed(1) : '0.0'
        return (
          <g key={b.range}>
            <rect x={cx - barW / 2} y={y(count)} width={barW} height={top + plotH - y(count)} fill={b.color} />
            <text x={cx} y={y(count) - 4} textAnchor="middle" fontSize="8" fontWeight="600" fill="#334155">
              {count} ({pct}%)
            </text>
            <text x={cx} y={H - bottom + 12} textAnchor="middle" fontSize="8" fill="#334155">
              {b.range}
            </text>
            <text x={cx} y={H - bottom + 22} textAnchor="middle" fontSize="8" fill="#64748b">
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-l-4 border-blue-600 pl-2 text-[13px] font-bold uppercase tracking-wide text-slate-900">
      {children}
    </h2>
  )
}

function Page({ n, total, footer, children }: { n: number; total: number; footer: string; children: React.ReactNode }) {
  return (
    <section className="mr-page">
      <div className="flex-1">{children}</div>
      <footer className="mt-4 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500">
        <span>{footer}</span>
        <span>
          Page {n} of {total}
        </span>
      </footer>
    </section>
  )
}

export default function MasterResultReport({ classLabel, term, subjects, missingSubjects, rows, onClose }: Props) {
  const { profile } = useAuth()
  const scale = useFitScale()
  const info = termInfo(term)
  const data = useMemo(() => buildReport(subjects, missingSubjects, rows), [subjects, missingSubjects, rows])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function downloadPdf() {
    const previous = document.title
    // Browsers use the page title as the default PDF file name
    document.title = `${classLabel}-Master-Result-${term}`.replace(/\s+/g, '-')
    const restore = () => {
      document.title = previous
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const { byAverage } = data
  const best = byAverage[0]
  const second = byAverage[1]
  const weak = [...byAverage].reverse().filter((s) => s.average < PASS_MARK)
  const weakest = byAverage[byAverage.length - 1]
  const below = data.bandCounts[4]
  const classSize = rows.length
  const incomplete = classSize - data.completeCount

  const chunks: ReportRow[][] = []
  for (let i = 0; i < data.sheetRows.length; i += ROWS_PER_PAGE) chunks.push(data.sheetRows.slice(i, i + ROWS_PER_PAGE))
  const totalPages = 1 + chunks.length + 1
  const footerText = `${SCHOOL_TITLE} • ${info.label} Class Performance Report`

  const abbreviated = data.active.filter((s) => abbreviate(s) !== s)

  const recs: { title: string; text: string }[] = []
  if (below > 0 && weakest) {
    recs.push({
      title: 'Remedial Support',
      text: `Organise short daily remedial sessions for the ${plural(below, 'student')} scoring below 50% overall, starting with ${weakest.name}.`,
    })
  }
  if (weak.length > 0) {
    recs.push({
      title: 'Subject Practice',
      text: `Introduce structured weekly practice and revision tasks in ${weak.map((s) => s.name).join(', ')}, where the class average is below the 50% pass mark.`,
    })
  } else {
    recs.push({
      title: 'Continuous Monitoring',
      text: 'Keep tracking every subject through regular Score Bank tasks so that any slip in performance is caught early.',
    })
  }
  if (best) {
    recs.push({
      title: 'Sustain Strengths',
      text: `Share the teaching approaches that worked in ${best.name} with other subject teachers, and keep recognising high achievers.`,
    })
  }
  recs.push({
    title: 'Parent Engagement',
    text: "Hold a short parents' meeting early next term to share this report and agree on support at home for learners who need it.",
  })

  const cards = [
    {
      label: 'Class Overall Average',
      value: `${data.classAverage.toFixed(2)}%`,
      sub: `Mean Total Score: ${data.meanTotal.toFixed(2)} / ${data.maxPossible}`,
      highlight: true,
    },
    {
      label: 'Highest Score',
      value: fmt(data.topTotal),
      sub: `${(data.toppers[0]?.average ?? 0).toFixed(1)}% (${namesLabel(data.toppers.map((t) => t.name))})`,
    },
    {
      label: 'Lowest Score',
      value: fmt(data.lowTotal),
      sub: `${(data.bottoms[0]?.average ?? 0).toFixed(1)}% (${namesLabel(data.bottoms.map((t) => t.name))})`,
    },
    {
      label: 'Class Pass Rate',
      value: `${data.passRate.toFixed(1)}%`,
      sub: `${data.passCount} of ${data.completeCount} Students (≥50%)`,
    },
  ]

  const dateText = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return createPortal(
    <div id="mr-print-root" role="dialog" aria-modal="true" aria-label="Master result report" className="fixed inset-0 z-[100] overflow-auto bg-slate-300">
      <style>{REPORT_CSS}</style>

      <div className="mr-noprint sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <button onClick={onClose} className="flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="hidden truncate text-sm font-semibold text-royal-900 sm:block">
          {classLabel} · {term} report
        </p>
        <button
          onClick={downloadPdf}
          className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </button>
      </div>

      <div className="mr-zoom py-4" style={{ zoom: scale }}>
        {/* ---------- PAGE 1: overview ---------- */}
        <Page n={1} total={totalPages} footer={footerText}>
          <div
            className="rounded-lg px-6 py-5 text-white"
            style={{ background: 'linear-gradient(120deg, #1e3a8a 0%, #172554 55%, #0f172a 100%)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[22px] font-extrabold tracking-wide">SAT ROYAL BASIC SCHOOL</h1>
                <p className="mt-1 text-[12px] text-blue-200">
                  {classLabel} — {info.label} Class Performance Report
                </p>
              </div>
              <div className="shrink-0 text-right text-[11px] leading-5">
                <p>
                  <b>Academic Session:</b> <span className="text-blue-100">{info.label}</span>
                </p>
                <p>
                  <b>Class Size:</b> <span className="text-blue-100">{classSize} Students</span>
                </p>
                <p>
                  <b>Total Subjects:</b> <span className="text-blue-100">{data.active.length} Subjects</span>
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-lg border px-2 py-2.5 text-center"
                style={{ borderColor: c.highlight ? '#bfdbfe' : '#e2e8f0', background: c.highlight ? '#eff6ff' : '#f8fafc' }}
              >
                <p className="text-[8.5px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
                <p className="mt-1 text-[22px] font-extrabold leading-none" style={{ color: c.highlight ? '#1d4ed8' : '#0f172a' }}>
                  {c.value}
                </p>
                <p className="mt-1.5 text-[9px] leading-tight text-slate-500">{c.sub}</p>
              </div>
            ))}
          </div>

          {incomplete > 0 && (
            <p className="mt-2 text-[9.5px] italic text-slate-500">
              Overall figures use the {data.completeCount} of {classSize} students who have results in all {data.active.length}{' '}
              subjects.
            </p>
          )}

          <div className="mt-4">
            <SectionHeading>1. Class Performance Overview &amp; Visualizations</SectionHeading>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-2">
              <SubjectBars stats={byAverage} />
            </div>
            <div className="rounded-lg border border-slate-200 p-2">
              <BandChart counts={data.bandCounts} total={data.completeCount} />
            </div>
          </div>

          <div className="mt-3 rounded-lg border-l-4 border-sky-500 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-800">
            <p className="font-bold">Key Performance Highlights:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {best && (
                <li>
                  <b>Highest Performing Subject:</b> <i>{best.name}</i> leads with a class average of <b>{best.average.toFixed(2)}%</b> (
                  {best.passRate.toFixed(1)}% pass rate)
                  {second && (
                    <>
                      , followed closely by <i>{second.name}</i> at <b>{second.average.toFixed(2)}%</b> ({second.passRate.toFixed(1)}%
                      pass rate)
                    </>
                  )}
                  .
                </li>
              )}
              {weak.length > 0 ? (
                <li>
                  <b>Critical Areas for Improvement:</b>{' '}
                  {weak.map((s, i) => (
                    <span key={s.name}>
                      {i > 0 && (i === weak.length - 1 ? ' and ' : ', ')}
                      <i>{s.name}</i> (<b>{s.average.toFixed(2)}%</b> average, {s.passRate.toFixed(1)}% pass rate)
                    </span>
                  ))}{' '}
                  averaged below the 50% pass mark.
                </li>
              ) : (
                weakest && (
                  <li>
                    <b>Areas to Watch:</b> No subject averaged below the 50% pass mark. The lowest was <i>{weakest.name}</i> at{' '}
                    <b>{weakest.average.toFixed(2)}%</b>.
                  </li>
                )
              )}
              <li>
                <b>Grade Band Breakdown:</b> {plural(data.bandCounts[0], 'student')} achieved Grade A (≥80%),{' '}
                {plural(data.bandCounts[1], 'student')} Grade B (70–79%), {plural(data.bandCounts[2], 'student')} Grade C (60–69%),{' '}
                {plural(data.bandCounts[3], 'student')} Grade D (50–59%), and {plural(data.bandCounts[4], 'student')} scored under 50%
                overall.
              </li>
            </ul>
          </div>

          <div className="mt-4">
            <SectionHeading>2. Subject-by-Subject Performance Analysis</SectionHeading>
          </div>
          <table className="mt-2 w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="text-white" style={{ background: '#1e293b' }}>
                {['Subject Name', 'Class Average', 'Highest Score', 'Lowest Score', 'Pass Count (≥50)', 'Pass Rate (%)', 'Performance Category'].map(
                  (h, i) => (
                    <th key={h} className={`border border-slate-600 px-2 py-1.5 font-semibold ${i === 0 ? 'text-left' : 'text-center'}`}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data.subjectStats.map((s, i) => {
                const cat = categoryFor(s.average)
                return (
                  <tr key={s.name} style={{ background: i % 2 ? '#f8fafc' : '#ffffff' }}>
                    <td className="border border-slate-200 px-2 py-1.5 font-bold">{s.name}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center font-bold">{s.average.toFixed(2)}%</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center font-bold text-green-600">{fmt(s.highest)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center font-bold text-red-600">{fmt(s.lowest)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                      {s.pass} / {s.scored}
                    </td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center font-bold">{s.passRate.toFixed(1)}%</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[9.5px] font-bold ${cat.cls}`}>{cat.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {missingSubjects.length > 0 && (
            <p className="mt-1.5 text-[9.5px] italic text-slate-500">
              Not included (no saved results yet): {missingSubjects.join(', ')}.
            </p>
          )}
        </Page>

        {/* ---------- BROAD SHEET PAGES ---------- */}
        {chunks.map((chunk, ci) => (
          <Page key={ci} n={2 + ci} total={totalPages} footer={footerText}>
            <SectionHeading>
              3. {classLabel.toUpperCase()} Complete Broad Sheet &amp; Student Rankings (1st to {ordinal(data.sheetRows.length)})
              {chunks.length > 1 ? ` — Part ${ci + 1}` : ''}
            </SectionHeading>
            <table className="mt-2 w-full border-collapse text-[10px]">
              <thead>
                <tr className="text-white" style={{ background: '#1e293b' }}>
                  <th className="border border-slate-600 px-1.5 py-1.5 text-center font-semibold">Rank</th>
                  <th className="border border-slate-600 px-1.5 py-1.5 text-left font-semibold">Student Name</th>
                  {data.active.map((s) => (
                    <th key={s} className="border border-slate-600 px-1 py-1.5 text-center font-semibold">
                      {abbreviate(s)}
                    </th>
                  ))}
                  <th className="border border-slate-600 px-1.5 py-1.5 text-center font-semibold">Total</th>
                  <th className="border border-slate-600 px-1.5 py-1.5 text-center font-semibold">Average</th>
                </tr>
              </thead>
              <tbody>
                {chunk.map((r, i) => (
                  <tr key={r.studentId} style={{ background: i % 2 ? '#f8fafc' : '#ffffff' }}>
                    <td className="border border-slate-200 px-1.5 py-[3px] text-center font-bold">{r.position ?? '—'}</td>
                    <td className="border border-slate-200 px-1.5 py-[3px] font-semibold">{r.name}</td>
                    {data.active.map((s) => (
                      <td key={s} className="border border-slate-200 px-1 py-[3px] text-center">
                        {r.scores[s] !== null && r.scores[s] !== undefined ? fmt(r.scores[s] as number) : '—'}
                      </td>
                    ))}
                    <td className="border border-slate-200 px-1.5 py-[3px] text-center font-bold">
                      {r.total !== null ? fmt(r.total) : '—'}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-[3px] text-center font-bold">
                      {r.average !== null ? `${r.average.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ci === chunks.length - 1 && (
              <div className="mt-2 space-y-1 text-[9px] text-slate-500">
                {abbreviated.length > 0 && (
                  <p>
                    {abbreviated.map((s, i) => (
                      <span key={s}>
                        {i > 0 && ' · '}
                        <b>{abbreviate(s)}</b> = {s}
                      </span>
                    ))}
                  </p>
                )}
                {incomplete > 0 && <p>Students marked “—” are missing a result in at least one subject and are not ranked.</p>}
              </div>
            )}
          </Page>
        ))}

        {/* ---------- LAST PAGE: recommendations ---------- */}
        <Page n={totalPages} total={totalPages} footer={footerText}>
          <SectionHeading>4. Key Recommendations &amp; Action Plan</SectionHeading>
          <p className="mt-3 text-[12px] font-bold text-slate-900">Targeted Interventions for {info.next}:</p>
          <p className="mockup mr-noprint mt-1 text-[10px] text-slate-400">Click any recommendation to edit it before downloading.</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[11.5px] leading-relaxed text-slate-800">
            {recs.map((r) => (
              <li key={r.title}>
                <b>{r.title}:</b>{' '}
                <span contentEditable suppressContentEditableWarning className="rounded outline-none focus:bg-yellow-50">
                  {r.text}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-16 grid grid-cols-3 gap-8 text-center text-[11px]">
            <div>
              <div className="border-t border-slate-500 pt-1">
                <p className="font-bold">Class Teacher</p>
                <p className="text-[10px] text-slate-500">{profile?.full_name || SCHOOL_TITLE}</p>
              </div>
            </div>
            <div>
              <div className="border-t border-slate-500 pt-1">
                <p className="font-bold">Headmaster</p>
                <p className="text-[10px] text-slate-500">{SCHOOL_TITLE}</p>
              </div>
            </div>
            <div>
              <div className="border-t border-slate-500 pt-1">
                <p className="font-bold">Academic Director</p>
                <p className="text-[10px] text-slate-500">{SCHOOL_TITLE}</p>
              </div>
            </div>
          </div>
          <p className="mt-6 text-[11px] text-slate-700">Date: {dateText}</p>
        </Page>
      </div>
    </div>,
    document.body
  )
}