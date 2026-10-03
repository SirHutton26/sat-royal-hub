import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Save,
  Loader2,
  Eye,
  RefreshCw,
  BookOpen,
  ChevronRight,
  Trash2,
  Info,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const TERMS = ['Term 1', 'Term 2', 'Term 3']

// Only this exam type is combined with the 4 Score Bank tasks.
// Every other exam type (Mid Term, Mock, Promotional) uses the exam score alone.
const TASK_EXAM_TYPE = 'End of Term Exam'

function isTaskExam(examType: string | null | undefined) {
  return examType === TASK_EXAM_TYPE
}

interface TeachingContext {
  classId: string
  className: string
  subjects: string[]
}

interface ScoreBankEntry {
  id: string
  title: string
  total_score: number
}

interface ExamSessionOption {
  id: string
  exam_type: string
}

interface Student {
  id: string
  full_name: string
  admission_number: string
}

interface TaskScoreRow {
  entry_id: string
  student_id: string
  score: number
}

interface ResultRow {
  studentId: string
  name: string
  admission: string
  taskScore: number | null
  taskMax: number | null
  componentA: number | null
  examScore: number | null
  componentB: number | null
  total: number | null
  grade: string | null
  position: number | null
}

interface SavedSba {
  key: string
  classId: string
  className: string
  subject: string
  term: string
  examType: string | null
}

type View = 'pick-context' | 'configure' | 'results'
type ToastState = { type: 'success' | 'error'; message: string } | null

function gradeFor(pct: number): { grade: string; label: string } {
  if (pct >= 80) return { grade: 'A', label: 'Highly Proficient' }
  if (pct >= 68) return { grade: 'B', label: 'Proficient' }
  if (pct >= 54) return { grade: 'C', label: 'Approaching Proficiency' }
  if (pct >= 40) return { grade: 'D', label: 'Developing' }
  return { grade: 'E', label: 'Emerging' }
}

function toExamGroupKey(level: string | null): 'creche_nursery' | 'kg_basic6' | 'jhs' | null {
  if (level === 'creche' || level === 'nursery') return 'creche_nursery'
  if (level === 'kg' || level === 'lower_primary' || level === 'upper_primary') return 'kg_basic6'
  if (level === 'jhs') return 'jhs'
  return null
}

// Step 1: convert whatever the 4 entries actually sum to, onto a 0–60 scale
function scaleRawTo60(raw: number, actualMax: number): number {
  if (actualMax <= 0) return 0
  return (raw / actualMax) * 60
}

// Step 2: a score out of 60 becomes its 50%-weight contribution
function sixtyScaleToComponentA(scaledTo60: number): number {
  return (scaledTo60 / 60) * 50
}

function computePositions(results: ResultRow[]): Map<string, number> {
  const complete = results.filter((r) => r.total !== null)
  const sorted = [...complete].sort((a, b) => (b.total as number) - (a.total as number))
  const positionMap = new Map<string, number>()
  let lastTotal: number | null = null
  let lastPosition = 0
  sorted.forEach((r, i) => {
    if (r.total !== lastTotal) {
      lastPosition = i + 1
      lastTotal = r.total
    }
    positionMap.set(r.studentId, lastPosition)
  })
  return positionMap
}

async function fetchTaskScores(entryIds: string[]): Promise<TaskScoreRow[]> {
  if (entryIds.length === 0) return []
  const { data } = await supabase.from('score_bank_scores').select('entry_id, student_id, score').in('entry_id', entryIds)
  return (data ?? []) as TaskScoreRow[]
}

function SavingOverlay({ text }: { text: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-royal-900/40 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-royal-400 border-t-transparent" />
        <img src={schoolLogo} alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1" />
      </div>
      <p className="mt-4 text-sm font-medium text-white">{text}</p>
    </div>
  )
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 2800)
    return () => clearTimeout(t)
  }, [toast, onClose])
  if (!toast) return null
  return (
    <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div className={`flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        <p className="text-sm font-medium">{toast.message}</p>
      </div>
    </div>
  )
}

export default function TeacherSba() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [contexts, setContexts] = useState<(TeachingContext & { levelGroup: string | null })[]>([])
  const [savedSbas, setSavedSbas] = useState<SavedSba[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('pick-context')
  const [toast, setToast] = useState<ToastState>(null)

  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState(TERMS[0])

  const [entries, setEntries] = useState<ScoreBankEntry[]>([])
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [examOptions, setExamOptions] = useState<ExamSessionOption[]>([])
  const [examSessionId, setExamSessionId] = useState('')
  const [savedExamId, setSavedExamId] = useState('') // exam of the SBA already saved for this class/subject/term
  const [configuring, setConfiguring] = useState(false)

  const [results, setResults] = useState<ResultRow[]>([])
  const [computing, setComputing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [opening, setOpening] = useState(false)
  const [fromSaved, setFromSaved] = useState(false)

  const [cardToDelete, setCardToDelete] = useState<SavedSba | null>(null)
  const [deleting, setDeleting] = useState(false)

  // The exam type decides how the SBA is built
  const selectedExamType = examOptions.find((o) => o.id === examSessionId)?.exam_type ?? null
  const needsTasks = isTaskExam(selectedExamType)

  async function loadSaved(list: (TeachingContext & { levelGroup: string | null })[]) {
    if (!profile) return
    const { data } = await supabase
      .from('sba_configs')
      .select('class_id, subject, term, exam_session_id')
      .eq('teacher_id', profile.id)

    const rows = (data as { class_id: string; subject: string; term: string; exam_session_id: string | null }[]) ?? []

    const examIds = Array.from(new Set(rows.map((r) => r.exam_session_id).filter((id): id is string => !!id)))
    const typeMap = new Map<string, string>()
    if (examIds.length > 0) {
      const { data: sess } = await supabase.from('exam_sessions').select('id, exam_type').in('id', examIds)
      for (const s of sess ?? []) typeMap.set(s.id, s.exam_type)
    }

    const classNames = new Map(list.map((c) => [c.classId, c.className]))
    const cards: SavedSba[] = rows.map((r) => ({
      key: `${r.class_id}|${r.subject}|${r.term}`,
      classId: r.class_id,
      className: classNames.get(r.class_id) ?? '',
      subject: r.subject,
      term: r.term,
      examType: r.exam_session_id ? typeMap.get(r.exam_session_id) ?? null : null,
    }))

    cards.sort(
      (a, b) =>
        a.className.localeCompare(b.className) ||
        a.subject.localeCompare(b.subject) ||
        TERMS.indexOf(a.term) - TERMS.indexOf(b.term)
    )
    setSavedSbas(cards)
  }

  async function loadContexts() {
    if (!profile) return
    const [myClassRes, assignmentsRes] = await Promise.all([
      supabase.from('classes').select('id, name, level_group').eq('teacher_id', profile.id).maybeSingle(),
      supabase.from('subject_assignments').select('subject, class_id, class:classes(name, level_group)').eq('teacher_id', profile.id),
    ])

    const map = new Map<string, TeachingContext & { levelGroup: string | null }>()

    if (myClassRes.data) {
      let subjectNames: string[] = []
      if (myClassRes.data.level_group) {
        const { data: subjectRows } = await supabase.from('subjects').select('name').eq('level_group', myClassRes.data.level_group).order('name')
        subjectNames = (subjectRows ?? []).map((s) => s.name)
      }
      map.set(myClassRes.data.id, { classId: myClassRes.data.id, className: myClassRes.data.name, levelGroup: myClassRes.data.level_group, subjects: subjectNames })
    }

    for (const row of (assignmentsRes.data as unknown as { subject: string; class_id: string; class: { name: string; level_group: string | null } | null }[]) ?? []) {
      const existing = map.get(row.class_id)
      if (existing) {
        if (!existing.subjects.includes(row.subject)) existing.subjects.push(row.subject)
      } else {
        map.set(row.class_id, { classId: row.class_id, className: row.class?.name ?? '', levelGroup: row.class?.level_group ?? null, subjects: [row.subject] })
      }
    }

    const list = Array.from(map.values())
    setContexts(list)
    if (list.length > 0) {
      setClassId(list[0].classId)
      setSubject(list[0].subjects[0] ?? '')
    }
    await loadSaved(list)
    setLoading(false)
  }

  useEffect(() => {
    loadContexts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const activeContext = useMemo(() => contexts.find((c) => c.classId === classId) ?? null, [contexts, classId])

  async function goToConfigure() {
    if (!classId || !subject) return
    setToast(null)
    setHasSaved(false)
    setFromSaved(false)

    const [entriesRes, existingConfigRes] = await Promise.all([
      supabase
        .from('score_bank_entries')
        .select('id, title, total_score')
        .eq('class_id', classId)
        .eq('subject', subject)
        .eq('term', term)
        .order('created_at', { ascending: false }),
      supabase.from('sba_configs').select('entry_ids, exam_session_id').eq('class_id', classId).eq('subject', subject).eq('term', term).maybeSingle(),
    ])
    setEntries(entriesRes.data ?? [])

    const groupKey = toExamGroupKey(activeContext?.levelGroup ?? null)
    if (groupKey) {
      // Only exams open to this class: either every class in the level (class_ids is null) or this class is on the list
      const { data: sessions } = await supabase
        .from('exam_sessions')
        .select('id, exam_type')
        .eq('group_key', groupKey)
        .eq('term', term)
        .or(`class_ids.is.null,class_ids.cs.{${classId}}`)
        .order('start_date', { ascending: false })
      setExamOptions(sessions ?? [])
    } else {
      setExamOptions([])
    }

    if (existingConfigRes.data) {
      setSelectedEntryIds(existingConfigRes.data.entry_ids ?? [])
      setExamSessionId(existingConfigRes.data.exam_session_id ?? '')
      setSavedExamId(existingConfigRes.data.exam_session_id ?? '')
    } else {
      setSelectedEntryIds([])
      setExamSessionId('')
      setSavedExamId('')
    }

    setView('configure')
  }

  // Open a previously generated SBA straight from its card (no regenerating)
  async function openSaved(card: SavedSba) {
    setOpening(true)
    setToast(null)
    setClassId(card.classId)
    setSubject(card.subject)
    setTerm(card.term)
    setFromSaved(true)

    const [cfgRes, entriesRes, studentsRes, savedRes] = await Promise.all([
      supabase
        .from('sba_configs')
        .select('entry_ids, exam_session_id')
        .eq('class_id', card.classId)
        .eq('subject', card.subject)
        .eq('term', card.term)
        .maybeSingle(),
      supabase
        .from('score_bank_entries')
        .select('id, title, total_score')
        .eq('class_id', card.classId)
        .eq('subject', card.subject)
        .eq('term', card.term)
        .order('created_at', { ascending: false }),
      supabase
        .from('students')
        .select('id, full_name, admission_number')
        .eq('class_id', card.classId)
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('sba_results')
        .select('student_id, component_a, exam_score, component_b, total_score, grade, position')
        .eq('class_id', card.classId)
        .eq('subject', card.subject)
        .eq('term', card.term),
    ])

    const entryList: ScoreBankEntry[] = entriesRes.data ?? []
    const entryIds: string[] = cfgRes.data?.entry_ids ?? []
    const examId: string = cfgRes.data?.exam_session_id ?? ''

    // Find out which exam type this SBA uses so the screen and any recompute follow the right rule
    let examType: string | null = null
    if (examId) {
      const { data: sess } = await supabase.from('exam_sessions').select('id, exam_type').eq('id', examId).maybeSingle()
      if (sess) {
        setExamOptions([sess])
        examType = sess.exam_type
      } else {
        setExamOptions([])
      }
    } else {
      setExamOptions([])
    }
    const useTasks = isTaskExam(examType)

    setEntries(entryList)
    setSelectedEntryIds(entryIds)
    setExamSessionId(examId)
    setSavedExamId(examId)

    const savedRows = savedRes.data ?? []

    if (savedRows.length > 0) {
      const savedMap = new Map(savedRows.map((r) => [r.student_id, r]))
      const merged: ResultRow[] = ((studentsRes.data ?? []) as Student[]).map((s) => {
        const r = savedMap.get(s.id)
        return {
          studentId: s.id,
          name: s.full_name,
          admission: s.admission_number,
          taskScore: null,
          taskMax: null,
          componentA: r?.component_a != null ? Number(r.component_a) : null,
          examScore: r?.exam_score != null ? Number(r.exam_score) : null,
          componentB: r?.component_b != null ? Number(r.component_b) : null,
          total: r?.total_score != null ? Number(r.total_score) : null,
          grade: r?.grade ?? null,
          position: r?.position ?? null,
        }
      })
      setResults(merged)
      setHasSaved(true)
    } else if (examId && (!useTasks || entryIds.length === 4)) {
      // Config exists but results were never saved: compute them once
      await computeResults(useTasks ? entryIds : [], examId, entryList, useTasks, card.classId, card.subject)
      setHasSaved(false)
    } else {
      setResults([])
      setHasSaved(false)
    }

    setOpening(false)
    setView('results')
  }

  function toggleEntry(id: string) {
    setSelectedEntryIds((prev) => {
      if (prev.includes(id)) return prev.filter((e) => e !== id)
      if (prev.length >= 4) return prev
      return [...prev, id]
    })
  }

  async function saveConfigAndCompute() {
    if (!profile) return
    if (!examSessionId) {
      setToast({ type: 'error', message: 'Choose which exam to use.' })
      return
    }
    if (needsTasks && selectedEntryIds.length !== 4) {
      setToast({ type: 'error', message: 'Select exactly 4 score bank entries.' })
      return
    }

    setConfiguring(true)

    // Exams other than End of Term don't use Score Bank entries at all
    const entryIds = needsTasks ? selectedEntryIds : []

    const { error } = await supabase.from('sba_configs').upsert(
      { class_id: classId, subject, term, entry_ids: entryIds, exam_session_id: examSessionId, teacher_id: profile.id },
      { onConflict: 'class_id,subject,term' }
    )

    if (error) {
      setConfiguring(false)
      setToast({ type: 'error', message: error.message })
      return
    }

    setSelectedEntryIds(entryIds)
    setSavedExamId(examSessionId)
    await computeResults(entryIds, examSessionId, entries, needsTasks, classId, subject)
    await loadSaved(contexts)
    setConfiguring(false)
    setView('results')
  }

  async function computeResults(
    entryIds: string[],
    examId: string,
    entryList: ScoreBankEntry[],
    useTasks: boolean,
    forClassId: string,
    forSubject: string
  ) {
    setComputing(true)
    const [studentsRes, taskScores, examScoresRes] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number').eq('class_id', forClassId).eq('is_active', true).order('full_name'),
      fetchTaskScores(useTasks ? entryIds : []),
      supabase.from('exam_scores').select('student_id, score').eq('exam_session_id', examId).eq('class_id', forClassId).eq('subject', forSubject),
    ])

    const studentList: Student[] = studentsRes.data ?? []
    const maxTotal = useTasks
      ? entryList.filter((e) => entryIds.includes(e.id)).reduce((sum, e) => sum + Number(e.total_score), 0)
      : null
    const examMap = new Map((examScoresRes.data ?? []).map((r) => [r.student_id, Number(r.score)]))

    const computed: ResultRow[] = studentList.map((s) => {
      const examScore = examMap.has(s.id) ? examMap.get(s.id)! : null

      let taskScore: number | null = null
      let componentA: number | null
      let componentB: number | null

      if (useTasks) {
        // End of Term: 4 Score Bank tasks (50) + exam (50)
        const studentEntryScores = taskScores.filter((r) => r.student_id === s.id && entryIds.includes(r.entry_id))
        const hasAllTasks = studentEntryScores.length === 4
        taskScore = hasAllTasks ? studentEntryScores.reduce((sum, r) => sum + Number(r.score), 0) : null

        // Explicit two-step conversion, as requested: raw → scale to /60 → then 50% weight
        const scaledTo60 = taskScore !== null && maxTotal !== null ? scaleRawTo60(taskScore, maxTotal) : null
        componentA = scaledTo60 !== null ? sixtyScaleToComponentA(scaledTo60) : null
        componentB = examScore !== null ? (examScore / 100) * 50 : null
      } else {
        // Mid Term, Mock, Promotional: the exam score alone, split in two equal halves
        componentA = examScore !== null ? examScore / 2 : null
        componentB = examScore !== null ? examScore / 2 : null
      }

      const total = componentA !== null && componentB !== null ? componentA + componentB : null
      const grade = total !== null ? gradeFor(total).grade : null

      return {
        studentId: s.id,
        name: s.full_name,
        admission: s.admission_number,
        taskScore,
        taskMax: maxTotal,
        componentA,
        examScore,
        componentB,
        total,
        grade,
        position: null,
      }
    })

    const positionMap = computePositions(computed)
    const withPositions = computed.map((r) => ({ ...r, position: positionMap.get(r.studentId) ?? null }))

    setResults(withPositions)
    setComputing(false)
  }

  // Recalculate from the latest Score Bank and exam scores
  async function recompute() {
    if (!examSessionId || (needsTasks && selectedEntryIds.length !== 4)) {
      setToast({ type: 'error', message: 'This SBA has no complete setup yet. Go back and configure it.' })
      return
    }
    await computeResults(needsTasks ? selectedEntryIds : [], examSessionId, entries, needsTasks, classId, subject)
    setHasSaved(false)
    setToast({ type: 'success', message: 'Results recomputed. Save to keep the changes.' })
  }

  async function saveResults() {
    setSaving(true)

    const rows = results
      .filter((r) => r.total !== null)
      .map((r) => ({
        class_id: classId,
        subject,
        term,
        student_id: r.studentId,
        component_a: r.componentA,
        exam_score: r.examScore,
        component_b: r.componentB,
        total_score: r.total,
        grade: r.grade,
        position: r.position,
      }))

    if (rows.length === 0) {
      setSaving(false)
      setToast({ type: 'error', message: 'No complete results to save yet.' })
      return
    }

    const { error } = await supabase.from('sba_results').upsert(rows, { onConflict: 'class_id,subject,term,student_id' })
    setSaving(false)
    if (error) {
      setToast({ type: 'error', message: error.message })
    } else {
      setToast({ type: 'success', message: 'SBA results saved!' })
      setHasSaved(true)
    }
  }

  async function confirmDeleteSba() {
    if (!cardToDelete) return
    setDeleting(true)

    // Saved results first, then the setup (Score Bank entries and exam scores are never touched)
    const { error: resultsError } = await supabase
      .from('sba_results')
      .delete()
      .eq('class_id', cardToDelete.classId)
      .eq('subject', cardToDelete.subject)
      .eq('term', cardToDelete.term)

    if (resultsError) {
      setDeleting(false)
      setToast({ type: 'error', message: resultsError.message })
      return
    }

    const { data, error } = await supabase
      .from('sba_configs')
      .delete()
      .eq('class_id', cardToDelete.classId)
      .eq('subject', cardToDelete.subject)
      .eq('term', cardToDelete.term)
      .select('class_id')

    setDeleting(false)

    if (error || !data || data.length === 0) {
      setToast({ type: 'error', message: error?.message ?? 'Could not delete this SBA. Check your permissions.' })
      return
    }

    setSavedSbas((prev) => prev.filter((c) => c.key !== cardToDelete.key))
    setCardToDelete(null)
    setToast({ type: 'success', message: 'SBA deleted.' })
  }

  function goToPreview() {
    navigate(`/teacher/sba/print?classId=${classId}&subject=${encodeURIComponent(subject)}&term=${encodeURIComponent(term)}`)
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  if (contexts.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">SBA</h1>
        <p className="mt-4 text-sm text-gray-400">You don't have a class or subject assignment yet.</p>
      </div>
    )
  }

  if (view === 'pick-context') {
    return (
      <div>
        <h1 className="text-xl font-semibold text-royal-900">SBA</h1>
        <p className="mt-1 text-sm text-gray-500">Combine Score Bank tasks with an exam to compute each student's SBA.</p>

        <div className="mt-4 max-w-sm space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {contexts.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-royal-900">Class</label>
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value)
                  const ctx = contexts.find((c) => c.classId === e.target.value)
                  setSubject(ctx?.subjects[0] ?? '')
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              >
                {contexts.map((c) => (
                  <option key={c.classId} value={c.classId}>
                    {c.className}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-royal-900">Subject</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              {activeContext?.subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Term</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={goToConfigure}
            disabled={!subject}
            className="w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            Next
          </button>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Your SBAs</h2>

        {savedSbas.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No SBAs generated yet. Pick a subject above to create one.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {savedSbas.map((card) => (
              <div
                key={card.key}
                className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
              >
                <button
                  onClick={() => openSaved(card)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 p-5 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-royal-900">{card.subject}</p>
                      <p className="truncate text-xs text-gray-500">
                        {card.className} · {card.term}
                      </p>
                      {card.examType && <p className="truncate text-xs text-gray-400">{card.examType}</p>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
                <button
                  onClick={() => setCardToDelete(card)}
                  aria-label={`Delete ${card.subject} SBA`}
                  className="mr-3 shrink-0 rounded-md p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {cardToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/40 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-royal-900">Delete this SBA?</h3>
              <p className="mt-1 text-sm text-gray-500">
                The saved SBA for {cardToDelete.subject} · {cardToDelete.className} · {cardToDelete.term} will be removed, including
                its results in the Master Result. Your Score Bank entries and exam scores are not affected. This can't be undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setCardToDelete(null)}
                  disabled={deleting}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteSba}
                  disabled={deleting}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {opening && <SavingOverlay text="Opening SBA..." />}
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )
  }

  if (view === 'configure') {
    const existingExamType = examOptions.find((o) => o.id === savedExamId)?.exam_type ?? null
    const replacesOther = !!savedExamId && !!examSessionId && savedExamId !== examSessionId

    return (
      <div>
        <button onClick={() => setView('pick-context')} className="flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mt-2 text-xl font-semibold text-royal-900">
          {subject} · {activeContext?.className} · {term}
        </h1>

        <div className="mt-4 max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {/* Step 1: the exam decides everything else */}
          <div>
            <label className="block text-sm font-medium text-royal-900">Exam to use</label>
            {examOptions.length === 0 ? (
              <p className="mt-1 text-xs text-red-500">No exams activated for this class and term yet.</p>
            ) : (
              <select
                value={examSessionId}
                onChange={(e) => setExamSessionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
              >
                <option value="">Choose an exam</option>
                {examOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.exam_type}
                  </option>
                ))}
              </select>
            )}
          </div>

          {replacesOther && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                An SBA for this subject and term already exists{existingExamType ? ` using ${existingExamType}` : ''}. Computing with
                this exam will replace it.
              </p>
            </div>
          )}

          {/* Step 2: depends on the exam type */}
          {!examSessionId ? (
            <p className="mt-4 text-sm text-gray-400">Choose an exam to continue.</p>
          ) : needsTasks ? (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-royal-900">Pick exactly 4 Score Bank entries</p>
              {entries.length === 0 ? (
                <p className="mt-2 text-sm text-gray-400">
                  No Score Bank entries yet for this subject and term. Add some in Score Bank first.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {entries.map((e) => {
                    const checked = selectedEntryIds.includes(e.id)
                    return (
                      <label
                        key={e.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                          checked ? 'border-royal-400 bg-royal-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleEntry(e.id)} className="h-4 w-4" />
                          {e.title}
                        </span>
                        <span className="text-xs text-gray-400">/{e.total_score}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400">{selectedEntryIds.length}/4 selected</p>
            </div>
          ) : (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-royal-100 bg-royal-50 p-3 text-xs text-royal-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-royal-500" />
              <div>
                <p className="font-semibold">{selectedExamType} doesn't use Score Bank tasks.</p>
                <p className="mt-1">
                  Only the exam score is used. It is split into two equal halves: one half is Sub-Total A and the other half is Exam B.
                  For example, an exam score of 72 gives Sub-Total A = 36 and Exam B = 36.
                </p>
              </div>
            </div>
          )}

          <button
            onClick={saveConfigAndCompute}
            disabled={configuring || !examSessionId}
            className="mt-4 w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {configuring ? 'Computing...' : 'Compute results'}
          </button>
        </div>

        {configuring && <SavingOverlay text="Computing results..." />}
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )
  }

  // ---------- RESULTS ----------
  return (
    <div>
      <button
        onClick={() => setView(fromSaved ? 'pick-context' : 'configure')}
        className="flex items-center gap-1 text-sm text-royal-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="mt-2 text-xl font-semibold text-royal-900">
        {subject} SBA · {activeContext?.className} · {term}
      </h1>
      {selectedExamType && (
        <p className="mt-0.5 text-sm text-gray-500">
          {selectedExamType}
          {!needsTasks && ' · exam score only'}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SN</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Sub-Total A</th>
              <th className="px-4 py-3">Exam B</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Position</th>
            </tr>
          </thead>
          <tbody>
            {computing ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  Computing...
                </td>
              </tr>
            ) : results.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  No students in this class.
                </td>
              </tr>
            ) : (
              results.map((r, i) => (
                <tr key={r.studentId} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-royal-900">{r.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.componentA !== null ? (
                      r.componentA.toFixed(1)
                    ) : (
                      <span className="text-gray-300">{needsTasks ? 'Incomplete' : 'No exam score'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.componentB !== null ? r.componentB.toFixed(1) : <span className="text-gray-300">No exam score</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-royal-900">{r.total !== null ? r.total.toFixed(1) : '—'}</td>
                  <td className="px-4 py-3">
                    {r.grade ? (
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${
                          r.grade === 'A' ? 'bg-green-600' : r.grade === 'B' ? 'bg-sky-600' : r.grade === 'C' ? 'bg-amber-500' : r.grade === 'D' ? 'bg-orange-500' : 'bg-red-600'
                        }`}
                      >
                        {r.grade}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.position ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {results.length > 0 && (
        <div className="sticky bottom-24 mt-4 flex flex-col items-end gap-2 rounded-xl bg-white p-3 shadow-lg md:bottom-4">
          {!hasSaved && <p className="text-xs text-gray-400">Save first, then preview, so the report shows saved results.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={recompute}
              disabled={computing}
              className="flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${computing ? 'animate-spin' : ''}`} />
              Recompute
            </button>
            <button
              onClick={goToPreview}
              className="flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-gray-50"
            >
              <Eye className="h-4 w-4" />
              Preview
            </button>
            <button
              onClick={saveResults}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save SBA results
            </button>
          </div>
        </div>
      )}

      {saving && <SavingOverlay text="Saving results..." />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}