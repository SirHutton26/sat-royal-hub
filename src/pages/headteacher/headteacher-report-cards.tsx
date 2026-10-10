import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileDown, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TERMS, loadCardSet, type CardSet, type ClassOption } from '@/lib/report-card'
import { buildReportCardsPdf } from '@/lib/report-card-pdf'
import { localISO } from '@/lib/attendance'
import { ordinal } from '@/lib/pdf-common'

const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function HeadteacherReportCards() {
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [classId, setClassId] = useState('')
  const [term, setTerm] = useState(TERMS[0])
  const [year, setYear] = useState('')
  const [date, setDate] = useState(localISO())
  const [withFees, setWithFees] = useState(true)
  const [set, setSet] = useState<CardSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState<string>('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('id, name, level_group').order('name'),
      supabase.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle(),
    ]).then(([c, s]) => {
      setClasses((c.data ?? []) as ClassOption[])
      if (s.data?.current_academic_year) setYear(s.data.current_academic_year)
      if (s.data?.current_term && TERMS.includes(s.data.current_term)) setTerm(s.data.current_term)
    })
  }, [])

  const cls = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId])

  useEffect(() => {
    if (!cls || !year) return setSet(null)
    let alive = true
    setLoading(true)
    setError('')
    loadCardSet(cls, term, year, withFees)
      .then((d) => alive && setSet(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load results'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [cls, term, year, withFees])

  async function make(which: 'all' | string) {
    if (!set) return
    setBuilding(which)
    try {
      const cards = which === 'all' ? set.cards : set.cards.filter((c) => c.studentId === which)
      const safe = (s: string) => s.replace(/[^\w]+/g, '-')
      await buildReportCardsPdf(
        cards,
        { className: set.className, term, year, date, rollCount: set.rollCount, jhs9: set.jhs9 },
        which === 'all' ? `report-cards-${safe(set.className)}-${safe(term)}.pdf` : `report-card-${safe(cards[0]?.name ?? 'student')}.pdf`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF')
    }
    setBuilding('')
  }

  const noResults = set && set.subjects.length === 0

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-royal-900">Report Cards</h1>
      <p className="mt-1 text-sm text-gray-500">Choose a class and term, then download the report cards as an A4 PDF (one page per student).</p>

      <div className="mt-5 grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium text-royal-900">
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={input}>
            <option value="">Choose a class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-royal-900">
          Term
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={input}>
            {TERMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-royal-900">
          Academic year
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026/2027" className={input} />
        </label>
        <label className="text-sm font-medium text-royal-900">
          Date on the card
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2 lg:col-span-4">
          <input type="checkbox" checked={withFees} onChange={(e) => setWithFees(e.target.checked)} className="h-4 w-4 accent-royal-600" />
          Fill in the fees reminder (arrears and next term's fees) from the bursar's records
        </label>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {loading && <Loader2 className="mt-5 h-5 w-5 animate-spin text-royal-600" />}

      {set && !loading && (
        <>
          {noResults ? (
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No saved SBA results for {set.className} in {term} yet. Teachers save them on the SBA page.
            </p>
          ) : (
            set.missingSubjects.length > 0 && (
              <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No saved results yet for: {set.missingSubjects.join(', ')}. They stay on the cards with empty scores.
              </p>
            )
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">
              <b>{set.className}</b> · {set.rollCount} students · {set.subjects.length} subjects · {set.jhs9 ? 'Grades 1-9 with aggregate' : 'Grades A-E'}
            </p>
            <button
              onClick={() => make('all')}
              disabled={noResults || !!building || set.cards.length === 0}
              className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-50"
            >
              {building === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Download all ({set.cards.length}) as PDF
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-royal-600 text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-right font-semibold">Average</th>
                  <th className="px-4 py-3 text-center font-semibold">Position</th>
                  {set.jhs9 && <th className="px-4 py-3 text-center font-semibold">Aggregate</th>}
                  <th className="px-4 py-3 text-right font-semibold">Card</th>
                </tr>
              </thead>
              <tbody>
                {set.cards.map((c, i) => (
                  <tr key={c.studentId} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-royal-900">{c.name}</td>
                    <td className="px-4 py-2.5 text-right">{c.average === null ? '-' : c.total}</td>
                    <td className="px-4 py-2.5 text-right">{c.average === null ? '-' : c.average.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-center">{c.position ? ordinal(c.position) : '-'}</td>
                    {set.jhs9 && <td className="px-4 py-2.5 text-center font-semibold">{c.aggregate ? c.aggregate.total : '-'}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => make(c.studentId)}
                        disabled={noResults || !!building}
                        className="rounded-md border border-royal-200 px-2.5 py-1 text-xs font-semibold text-royal-700 hover:bg-royal-50 disabled:opacity-50"
                      >
                        {building === c.studentId ? 'Making...' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
                {set.cards.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No active students in this class.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
