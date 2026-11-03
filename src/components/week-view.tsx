import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { PRINT_CSS, PlanView, PrintablePlan } from '@/components/lesson-plan-view'
import type { PlanRow } from '@/lib/lesson-plan'
import { dateOf } from '@/lib/scheme'

const dayLabel = (p: PlanRow, i: number) =>
  p.lesson_date ? dateOf(p.lesson_date.slice(0, 10)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : `Lesson ${i + 1}`

/** The lessons written together for one week: a tab for each day, and one button to print them all */
export function WeekView({
  plans,
  teacherName,
  onBack,
  onSaved,
  onDeleted,
}: {
  plans: PlanRow[]
  teacherName: string
  onBack: () => void
  onSaved: (row: PlanRow) => void
  onDeleted: (id: string) => void
}) {
  const [activeId, setActiveId] = useState(plans[0]?.id)
  const [mode, setMode] = useState<'one' | 'all'>('one')
  const active = plans.find((p) => p.id === activeId) ?? plans[0]
  if (!active) return null
  const first = plans[0]

  function printWeek() {
    // show every lesson for the printer first, then go back to one lesson once printing is over
    flushSync(() => setMode('all'))
    window.addEventListener('afterprint', () => setMode('one'), { once: true })
    window.print()
  }

  return (
    <div data-print={mode}>
      <style>{PRINT_CSS}</style>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to lesson plans
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-royal-900">
            {first.week_no ? `Week ${first.week_no}` : 'Weekly plan'}
            {first.sub_strand ? ` · ${first.sub_strand}` : ''}
          </h1>
          <p className="text-sm text-gray-500">
            {first.class_name} · {first.subject}
            {first.term ? ` · ${first.term}` : ''} · {plans.length} lesson{plans.length === 1 ? '' : 's'}
          </p>
        </div>
        {plans.length > 1 && (
          <button onClick={printWeek} className="flex items-center gap-1.5 rounded-lg bg-gold-400 px-4 py-2 text-sm font-bold text-royal-900 hover:bg-gold-500">
            <Printer className="h-4 w-4" /> Print the whole week
          </button>
        )}
      </div>

      {plans.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Days of the week">
          {plans.map((p, i) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === active.id}
              onClick={() => setActiveId(p.id)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${p.id === active.id ? 'border-royal-600 bg-royal-600 text-white' : 'border-gray-300 bg-white text-royal-900 hover:border-royal-400'}`}
            >
              {dayLabel(p, i)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2">
        <PlanView key={active.id} row={active} teacherName={teacherName} hideBack onBack={onBack} onSaved={onSaved} onDeleted={onDeleted} />
      </div>

      {/* every lesson on its own page, used only when the whole week is printed */}
      <div id="lp-print-all" className="lp-all">
        {plans.map((p, i) => (
          <div key={p.id} className={i < plans.length - 1 ? 'lp-break' : ''}>
            <PrintablePlan row={p} teacherName={teacherName} />
          </div>
        ))}
      </div>
    </div>
  )
}
