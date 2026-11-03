import { useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Pencil, Printer, Save, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import schoolLogo from '@/assets/school-logo.png'
import { SCHOOL } from '@/lib/pdf-common'
import { fmtDate, fromLines, toLines, type Plan, type PlanRow } from '@/lib/lesson-plan'

export const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100 disabled:bg-gray-50 disabled:text-gray-400'

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-sm font-medium text-royal-900 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-xs font-normal text-gray-500">{hint}</div>}
    </label>
  )
}

/* =============================================================== plan viewer / editor */

interface Draft {
  title: string
  performance: string
  competencies: string
  keyWords: string
  resources: string
  previous: string
  phases: { minutes: string; teacher: string; learner: string }[]
  assessment: string
  homework: string
}

const draftOf = (p: Plan): Draft => ({
  title: p.title,
  performance: toLines(p.performance_indicators),
  competencies: toLines(p.core_competencies),
  keyWords: toLines(p.key_words),
  resources: toLines(p.learning_resources),
  previous: p.previous_knowledge,
  phases: p.phases.map((x) => ({ minutes: String(x.minutes), teacher: toLines(x.teacher_activities), learner: toLines(x.learner_activities) })),
  assessment: toLines(p.assessment),
  homework: p.homework,
})

function planOf(d: Draft, old: Plan): Plan {
  return {
    title: d.title.trim() || old.title,
    performance_indicators: fromLines(d.performance),
    core_competencies: fromLines(d.competencies),
    key_words: fromLines(d.keyWords),
    learning_resources: fromLines(d.resources),
    previous_knowledge: d.previous.trim(),
    phases: old.phases.map((x, i) => ({
      name: x.name,
      minutes: Math.max(1, Math.round(Number(d.phases[i].minutes)) || x.minutes),
      teacher_activities: fromLines(d.phases[i].teacher),
      learner_activities: fromLines(d.phases[i].learner),
    })),
    assessment: fromLines(d.assessment),
    homework: d.homework.trim(),
  }
}

export const PRINT_CSS = `.lp-all { display: none; }
@media print {
  body * { visibility: hidden !important; }
  #lp-print, #lp-print *, #lp-print-all, #lp-print-all * { visibility: visible !important; }
  #lp-print, #lp-print-all { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
  [data-print="all"] #lp-print { display: none !important; }
  [data-print="one"] #lp-print-all { display: none !important; }
  .lp-all { display: block; }
  .lp-break { break-after: page; page-break-after: always; }
  @page { size: A4; margin: 12mm; }
}`

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-gray-400">—</span>
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  )
}

export function PrintablePlan({
  row,
  teacherName,
  id,
  className = '',
}: {
  row: PlanRow
  teacherName: string
  id?: string
  className?: string
}) {
  const p = row.plan
  const info: [string, string][] = [
    ['Teacher', teacherName],
    ['Class', row.class_name],
    ['Subject', row.subject],
    ['Date', fmtDate(row.lesson_date)],
    ['Duration', `${row.duration_minutes} minutes`],
    ['Class size', row.class_size ? String(row.class_size) : ''],
  ]

  return (
    <div id={id} className={`rounded-2xl bg-white p-6 text-sm text-gray-800 shadow-sm ${className}`}>
          <div className="flex items-center gap-4 border-b-2 border-gray-800 pb-3">
            <img src={schoolLogo} alt="" className="h-14 w-14 object-contain" />
            <div className="flex-1 text-center">
              <p className="text-lg font-bold uppercase text-royal-900">{SCHOOL.name}</p>
              <p className="text-xs font-semibold">{SCHOOL.place}</p>
            </div>
            <div className="h-14 w-14" />
          </div>
          <p className="mt-3 text-center text-base font-bold uppercase tracking-wide">Lesson Plan</p>
          <p className="text-center text-sm font-semibold text-royal-900">{p.title}</p>

          <table className="mt-3 w-full border-collapse text-sm">
            <tbody>
              {[0, 2, 4].map((i) => (
                <tr key={i}>
                  {info.slice(i, i + 2).map(([k, v]) => (
                    <td key={k} colSpan={1} className="w-1/2 border border-gray-400 px-2 py-1.5">
                      <b>{k}:</b> {v || <span className="text-gray-400">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {row.strand && (
                <tr><td colSpan={2} className="border border-gray-400 px-2 py-1.5"><b>Strand:</b> {row.strand}</td></tr>
              )}
              {row.sub_strand && (
                <tr><td colSpan={2} className="border border-gray-400 px-2 py-1.5"><b>Sub-strand:</b> {row.sub_strand}</td></tr>
              )}
              {row.content_standard && (
                <tr><td colSpan={2} className="border border-gray-400 px-2 py-1.5"><b>Content standard:</b> {row.content_standard}</td></tr>
              )}
              <tr>
                <td colSpan={2} className="border border-gray-400 px-2 py-1.5">
                  <b>Indicator(s):</b>
                  <ul className="mt-0.5 list-disc pl-5">
                    {row.indicators.map((x, i) => (
                      <li key={i}>{x.code ? <span className="font-semibold">{x.code} </span> : null}{x.text}</li>
                    ))}
                  </ul>
                </td>
              </tr>
              <tr><td colSpan={2} className="border border-gray-400 px-2 py-1.5"><b>Performance indicators:</b><div className="mt-0.5"><Bullets items={p.performance_indicators} /></div></td></tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1.5 align-top"><b>Core competencies:</b><div className="mt-0.5"><Bullets items={p.core_competencies} /></div></td>
                <td className="border border-gray-400 px-2 py-1.5 align-top"><b>Key words:</b> {p.key_words.join(', ') || <span className="text-gray-400">—</span>}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1.5 align-top"><b>Learning resources:</b><div className="mt-0.5"><Bullets items={p.learning_resources} /></div></td>
                <td className="border border-gray-400 px-2 py-1.5 align-top"><b>Previous knowledge:</b> {p.previous_knowledge || <span className="text-gray-400">—</span>}</td>
              </tr>
            </tbody>
          </table>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="w-32 border border-gray-400 px-2 py-1.5">Phase</th>
                <th className="border border-gray-400 px-2 py-1.5">Teacher activities</th>
                <th className="border border-gray-400 px-2 py-1.5">Learner activities</th>
              </tr>
            </thead>
            <tbody>
              {p.phases.map((ph) => (
                <tr key={ph.name} className="align-top">
                  <td className="border border-gray-400 px-2 py-1.5 font-semibold">{ph.name}<div className="text-xs font-normal text-gray-500">{ph.minutes} min</div></td>
                  <td className="border border-gray-400 px-2 py-1.5"><Bullets items={ph.teacher_activities} /></td>
                  <td className="border border-gray-400 px-2 py-1.5"><Bullets items={ph.learner_activities} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="mt-3 w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1.5 align-top">
                  <b>Assessment:</b>
                  <ol className="mt-0.5 list-decimal pl-5">
                    {p.assessment.map((x, i) => <li key={i}>{x}</li>)}
                  </ol>
                </td>
              </tr>
              {p.homework && (
                <tr><td className="border border-gray-400 px-2 py-1.5"><b>Homework:</b> {p.homework}</td></tr>
              )}
              <tr><td className="border border-gray-400 px-2 py-1.5"><b>Reflection:</b> <div className="h-10" /></td></tr>
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-6 text-xs">
            <p>Teacher's signature: ____________________</p>
            <p>Headteacher's remarks: ____________________</p>
          </div>
    </div>
  )
}

export function PlanView({
  row,
  teacherName,
  onBack,
  onSaved,
  onDeleted,
  hideBack,
}: {
  row: PlanRow
  teacherName: string
  hideBack?: boolean
  onBack: () => void
  onSaved: (row: PlanRow) => void
  onDeleted: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftOf(row.plan))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const p = row.plan

  function startEdit() {
    setDraft(draftOf(row.plan))
    setError('')
    setSaved(false)
    setEditing(true)
  }

  async function save() {
    const next = planOf(draft, row.plan)
    if (!next.performance_indicators.length) return setError('Keep at least one performance indicator.')
    if (next.phases.some((x) => !x.teacher_activities.length || !x.learner_activities.length)) return setError('Each phase needs teacher activities and learner activities.')
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('lesson_plans').update({ plan: next, title: next.title }).eq('id', row.id)
    setSaving(false)
    if (err) return setError(err.message)
    onSaved({ ...row, title: next.title, plan: next })
    setEditing(false)
    setSaved(true)
  }

  async function remove() {
    if (!confirm('Delete this lesson plan? This cannot be undone.')) return
    const { error: err } = await supabase.from('lesson_plans').delete().eq('id', row.id)
    if (err) return setError(err.message)
    onDeleted(row.id)
  }

  const setPhase = (i: number, k: 'minutes' | 'teacher' | 'learner', v: string) =>
    setDraft((d) => ({ ...d, phases: d.phases.map((x, n) => (n === i ? { ...x, [k]: v } : x)) }))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))


  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hideBack ? (
          <span />
        ) : (
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-royal-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to lesson plans
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
                <X className="h-4 w-4" /> Cancel
              </button>
              <button onClick={() => void save()} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
              </button>
            </>
          ) : (
            <>
              <button onClick={startEdit} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold text-royal-900 hover:bg-gray-50">
                <Pencil className="h-4 w-4" /> Edit
              </button>
              <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700">
                <Printer className="h-4 w-4" /> Print / Save as PDF
              </button>
              <button onClick={() => void remove()} aria-label="Delete lesson plan" title="Delete" className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {saved && !editing && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" /> Changes saved.
        </p>
      )}
      {!editing && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This plan was written by AI. Read it through and change anything that does not suit your class before you teach it.
        </p>
      )}

      {editing ? (
        <div className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <Field label="Lesson title">
            <input value={draft.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
          </Field>
          <p className="text-xs text-gray-500">Write one item per line.</p>
          <Field label="Performance indicators">
            <textarea rows={3} value={draft.performance} onChange={(e) => set('performance', e.target.value)} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Core competencies">
              <textarea rows={3} value={draft.competencies} onChange={(e) => set('competencies', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Key words">
              <textarea rows={3} value={draft.keyWords} onChange={(e) => set('keyWords', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Learning resources">
              <textarea rows={3} value={draft.resources} onChange={(e) => set('resources', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Previous knowledge">
              <textarea rows={3} value={draft.previous} onChange={(e) => set('previous', e.target.value)} className={inputClass} />
            </Field>
          </div>
          {p.phases.map((ph, i) => (
            <fieldset key={ph.name} className="rounded-xl border border-gray-200 p-4">
              <legend className="px-2 text-sm font-semibold text-royal-900">{ph.name}</legend>
              <div className="grid gap-3 sm:grid-cols-[110px_1fr_1fr]">
                <Field label="Minutes">
                  <input type="number" min={1} value={draft.phases[i].minutes} onChange={(e) => setPhase(i, 'minutes', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Teacher activities">
                  <textarea rows={5} value={draft.phases[i].teacher} onChange={(e) => setPhase(i, 'teacher', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Learner activities">
                  <textarea rows={5} value={draft.phases[i].learner} onChange={(e) => setPhase(i, 'learner', e.target.value)} className={inputClass} />
                </Field>
              </div>
            </fieldset>
          ))}
          <Field label="Assessment">
            <textarea rows={4} value={draft.assessment} onChange={(e) => set('assessment', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Homework">
            <textarea rows={2} value={draft.homework} onChange={(e) => set('homework', e.target.value)} className={inputClass} />
          </Field>
        </div>
      ) : (
        <PrintablePlan id="lp-print" row={row} teacherName={teacherName} className="mt-4" />
      )}
    </div>
  )
}

