import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ---------- types & constants ---------- */

type Duty = 'class_teacher' | 'subject_teacher' | 'bursar' | 'headteacher' | 'assistant_headteacher' | 'store_keeper' | 'cook' | 'security' | 'other'
type Status = 'active' | 'on_leave' | 'left'

interface Staff {
  id: string
  full_name: string
  date_of_birth: string | null
  gender: 'male' | 'female' | null
  gps_address: string | null
  hometown: string | null
  contact: string | null
  email: string | null
  date_appointed: string | null
  duty: Duty
  duty_other: string | null
  class_id: string | null
  level: string | null
  subjects: string[] | null
  ghana_card_no: string | null
  health_insurance_no: string | null
  ssnit_no: string | null
  qualification: string | null
  teacher_licence_no: string | null
  next_of_kin_name: string | null
  next_of_kin_contact: string | null
  status: Status
}

interface ClassRow {
  id: string
  name: string
  level_group: string | null
}
interface SubjectRow {
  name: string
  level_group: string | null
}

const COLUMNS =
  'id, full_name, date_of_birth, gender, gps_address, hometown, contact, email, date_appointed, duty, duty_other, class_id, level, subjects, ghana_card_no, health_insurance_no, ssnit_no, qualification, teacher_licence_no, next_of_kin_name, next_of_kin_contact, status'

const DUTIES: { value: Duty; label: string; teaching: boolean }[] = [
  { value: 'class_teacher', label: 'Class Teacher', teaching: true },
  { value: 'subject_teacher', label: 'Subject Teacher', teaching: true },
  { value: 'headteacher', label: 'Headteacher', teaching: false },
  { value: 'assistant_headteacher', label: 'Assistant Headteacher', teaching: false },
  { value: 'bursar', label: 'Bursar', teaching: false },
  { value: 'store_keeper', label: 'Store Keeper', teaching: false },
  { value: 'cook', label: 'Cook', teaching: false },
  { value: 'security', label: 'Security', teaching: false },
  { value: 'other', label: 'Other', teaching: false },
]

const LEVELS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary' },
  { value: 'upper_primary', label: 'Upper Primary' },
  { value: 'jhs', label: 'JHS' },
]

const STATUSES: { value: Status; label: string; badge: string }[] = [
  { value: 'active', label: 'Active', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  { value: 'on_leave', label: 'On leave', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  { value: 'left', label: 'Left school', badge: 'bg-gray-100 text-gray-600 ring-gray-200' },
]

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const dutyInfo = (d: Duty) => DUTIES.find((x) => x.value === d)
const levelLabel = (v: string | null) => LEVELS.find((l) => l.value === v)?.label ?? ''
const isTeaching = (d: Duty) => dutyInfo(d)?.teaching ?? false

/* ---------- helpers ---------- */

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Whole months from an ISO date to now */
function monthsSince(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const now = new Date()
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
  if (now.getDate() < d) months -= 1
  return Math.max(0, months)
}

const ageOf = (dob: string | null) => (dob ? Math.floor(monthsSince(dob) / 12) : null)

function servedText(from: string | null) {
  if (!from) return ''
  const mo = monthsSince(from)
  const y = Math.floor(mo / 12)
  const m = mo % 12
  if (!y && !m) return 'Less than a month'
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ')
}

/** Details the headteacher still has to collect for a record to count as complete */
function missingOf(r: Staff): string[] {
  const out: string[] = []
  const need: [unknown, string][] = [
    [r.date_of_birth, 'Date of birth'],
    [r.gender, 'Gender'],
    [r.gps_address, 'GPS address'],
    [r.hometown, 'Hometown'],
    [r.contact, 'Contact'],
    [r.date_appointed, 'Date appointed'],
    [r.ghana_card_no, 'Ghana Card No.'],
    [r.health_insurance_no, 'Health insurance No.'],
    [r.ssnit_no, 'SSNIT No.'],
  ]
  for (const [v, label] of need) if (!v) out.push(label)
  if (r.duty === 'class_teacher' && !r.class_id) out.push('Class')
  if (r.duty === 'subject_teacher') {
    if (!r.level) out.push('Level')
    if (!r.subjects?.length) out.push('Subjects')
  }
  return out
}

function normaliseCard(v: string) {
  const s = v.trim().toUpperCase().replace(/\s+/g, '')
  const m = s.match(/^GHA-?(\d{9})-?(\d)$/)
  return m ? `GHA-${m[1]}-${m[2]}` : s
}

/* ---------- form ---------- */

interface Form {
  full_name: string
  date_of_birth: string
  gender: '' | 'male' | 'female'
  gps_address: string
  hometown: string
  contact: string
  email: string
  date_appointed: string
  duty: Duty | ''
  duty_other: string
  class_id: string
  level: string
  subjects: string[]
  also_subjects: boolean
  ghana_card_no: string
  health_insurance_no: string
  ssnit_no: string
  qualification: string
  teacher_licence_no: string
  next_of_kin_name: string
  next_of_kin_contact: string
  status: Status
}

const EMPTY: Form = {
  full_name: '', date_of_birth: '', gender: '', gps_address: '', hometown: '', contact: '', email: '', date_appointed: '',
  duty: '', duty_other: '', class_id: '', level: '', subjects: [], also_subjects: false,
  ghana_card_no: '', health_insurance_no: '', ssnit_no: '', qualification: '', teacher_licence_no: '',
  next_of_kin_name: '', next_of_kin_contact: '', status: 'active',
}

function formOf(r: Staff): Form {
  return {
    full_name: r.full_name, date_of_birth: r.date_of_birth ?? '', gender: r.gender ?? '', gps_address: r.gps_address ?? '',
    hometown: r.hometown ?? '', contact: r.contact ?? '', email: r.email ?? '', date_appointed: r.date_appointed ?? '',
    duty: r.duty, duty_other: r.duty_other ?? '', class_id: r.class_id ?? '', level: r.level ?? '', subjects: r.subjects ?? [],
    also_subjects: r.duty === 'class_teacher' && (r.subjects?.length ?? 0) > 0,
    ghana_card_no: r.ghana_card_no ?? '', health_insurance_no: r.health_insurance_no ?? '', ssnit_no: r.ssnit_no ?? '',
    qualification: r.qualification ?? '', teacher_licence_no: r.teacher_licence_no ?? '',
    next_of_kin_name: r.next_of_kin_name ?? '', next_of_kin_contact: r.next_of_kin_contact ?? '', status: r.status,
  }
}

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-sm font-medium text-royal-900 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-xs font-normal text-gray-500">{hint}</div>}
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="border-b border-gray-100 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/40 px-3 py-6">
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative flex max-h-full w-full flex-col rounded-2xl bg-white shadow-xl ${wide ? 'max-w-2xl' : 'max-w-sm'}`}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-royal-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- page ---------- */

const NO_FILTERS = { duty: 'all', level: 'all', gender: 'all', status: 'all', records: 'all' }

export default function HeadteacherStaffParticulars() {
  const [rows, setRows] = useState<Staff[]>([])
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [catalog, setCatalog] = useState<SubjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; row: Staff }>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [formError, setFormError] = useState('')
  const [customSubject, setCustomSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Staff | null>(null)
  const [deleting, setDeleting] = useState(false)

  const toastTimer = useRef<number | undefined>(undefined)
  function showToast(type: 'ok' | 'error', text: string) {
    window.clearTimeout(toastTimer.current)
    setToast({ type, text })
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, cls, subs] = await Promise.all([
      supabase.from('staff_particulars').select(COLUMNS).order('full_name'),
      supabase.from('classes').select('id, name, level_group'),
      supabase.from('subjects').select('name, level_group'),
    ])
    if (staff.error) {
      setLoadError(
        staff.error.code === '42P01' || /does not exist|schema cache/i.test(staff.error.message)
          ? 'The staff particulars table is not set up yet. Run the SQL file 20261026_staff_particulars.sql in Supabase, then refresh.'
          : staff.error.message,
      )
    } else {
      setLoadError('')
      setRows((staff.data ?? []) as Staff[])
    }
    setClasses(((cls.data ?? []) as ClassRow[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
    setCatalog((subs.data ?? []) as SubjectRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const className = useCallback((id: string | null) => classes.find((c) => c.id === id)?.name ?? '', [classes])
  const dutyText = (r: Staff) => (r.duty === 'other' ? r.duty_other || 'Other' : dutyInfo(r.duty)?.label ?? r.duty)
  const levelOf = useCallback(
    (r: Staff) => (r.duty === 'class_teacher' ? classes.find((c) => c.id === r.class_id)?.level_group ?? r.level : r.level),
    [classes],
  )

  /* ----- stats (whole staff, not just what is filtered) ----- */
  const stats = useMemo(() => {
    const teaching = rows.filter((r) => isTeaching(r.duty)).length
    return {
      total: rows.length,
      teaching,
      nonTeaching: rows.length - teaching,
      male: rows.filter((r) => r.gender === 'male').length,
      female: rows.filter((r) => r.gender === 'female').length,
      incomplete: rows.filter((r) => missingOf(r).length > 0).length,
    }
  }, [rows])

  /* ----- search + filters ----- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.duty !== 'all' && r.duty !== filters.duty) return false
      if (filters.level !== 'all' && levelOf(r) !== filters.level) return false
      if (filters.gender !== 'all' && r.gender !== filters.gender) return false
      if (filters.status !== 'all' && r.status !== filters.status) return false
      if (filters.records === 'incomplete' && missingOf(r).length === 0) return false
      if (!q) return true
      const hay = [
        r.full_name, dutyText(r), className(r.class_id), (r.subjects ?? []).join(' '), r.contact, r.email, r.hometown,
        r.gps_address, r.ghana_card_no, r.health_insurance_no, r.ssnit_no, r.qualification,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filters, classes])

  const activeFilters = Object.entries(filters).filter(([, v]) => v !== 'all').length

  /* ----- form helpers ----- */
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setFormError('')
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setForm(EMPTY)
    setFormError('')
    setCustomSubject('')
    setModal({ mode: 'add' })
  }
  function openEdit(r: Staff) {
    setForm(formOf(r))
    setFormError('')
    setCustomSubject('')
    setModal({ mode: 'edit', row: r })
  }

  const formClassLevel = classes.find((c) => c.id === form.class_id)?.level_group ?? ''
  const formLevel = form.duty === 'class_teacher' ? formClassLevel : form.level
  const showSubjects = form.duty === 'subject_teacher' || (form.duty === 'class_teacher' && form.also_subjects)
  const subjectOptions = useMemo(() => {
    const fromCatalog = catalog.filter((s) => s.level_group === formLevel).map((s) => s.name)
    return [...new Set([...fromCatalog, ...form.subjects])].sort((a, b) => a.localeCompare(b))
  }, [catalog, formLevel, form.subjects])
  const sameClassTeacher =
    form.duty === 'class_teacher' && form.class_id
      ? rows.find((r) => r.duty === 'class_teacher' && r.class_id === form.class_id && (modal?.mode !== 'edit' || r.id !== modal.row.id))
      : undefined

  function addCustomSubject() {
    const s = customSubject.trim()
    if (!s) return
    if (!form.subjects.some((x) => x.toLowerCase() === s.toLowerCase())) set('subjects', [...form.subjects, s])
    setCustomSubject('')
  }
  const toggleSubject = (s: string) => set('subjects', form.subjects.includes(s) ? form.subjects.filter((x) => x !== s) : [...form.subjects, s])

  async function save() {
    const today = todayISO()
    const name = form.full_name.trim().replace(/\s+/g, ' ')
    if (!name) return setFormError('Enter the staff member\u2019s name.')
    if (!form.duty) return setFormError('Choose the duty.')
    if (form.duty === 'other' && !form.duty_other.trim()) return setFormError('Say what the duty is.')
    if (form.date_of_birth && form.date_of_birth > today) return setFormError('Date of birth cannot be in the future.')
    if (form.date_appointed && form.date_appointed > today) return setFormError('Date appointed cannot be in the future.')
    if (form.date_of_birth && form.date_appointed && form.date_appointed < form.date_of_birth) return setFormError('Date appointed cannot be before the date of birth.')
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setFormError('Enter a valid email address.')
    for (const [v, what] of [[form.contact, 'contact'], [form.next_of_kin_contact, 'next of kin contact']] as const) {
      if (v.trim() && !/^\+?[\d\s-]{9,}$/.test(v.trim())) return setFormError(`Enter a valid phone number for the ${what}.`)
    }
    const card = form.ghana_card_no.trim() ? normaliseCard(form.ghana_card_no) : ''
    if (card && !/^GHA-\d{9}-\d$/.test(card)) return setFormError('Ghana Card number should look like GHA-000000000-0.')
    if (form.duty === 'class_teacher' && !form.class_id) return setFormError('Choose the class this teacher handles.')
    if (form.duty === 'subject_teacher' && !form.level) return setFormError('Choose the level this teacher teaches.')

    const teaching = isTeaching(form.duty)
    const subjects = showSubjects ? form.subjects : []
    const payload = {
      full_name: name,
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      gps_address: form.gps_address.trim() || null,
      hometown: form.hometown.trim() || null,
      contact: form.contact.trim() || null,
      email: form.email.trim() || null,
      date_appointed: form.date_appointed || null,
      duty: form.duty,
      duty_other: form.duty === 'other' ? form.duty_other.trim() : null,
      class_id: form.duty === 'class_teacher' ? form.class_id : null,
      level: teaching ? formLevel || null : null,
      subjects,
      ghana_card_no: card || null,
      health_insurance_no: form.health_insurance_no.trim() || null,
      ssnit_no: form.ssnit_no.trim() || null,
      qualification: form.qualification.trim() || null,
      teacher_licence_no: teaching ? form.teacher_licence_no.trim() || null : null,
      next_of_kin_name: form.next_of_kin_name.trim() || null,
      next_of_kin_contact: form.next_of_kin_contact.trim() || null,
      status: form.status,
    }

    setSaving(true)
    const { error } =
      modal?.mode === 'edit'
        ? await supabase.from('staff_particulars').update(payload).eq('id', modal.row.id)
        : await supabase.from('staff_particulars').insert(payload)
    setSaving(false)

    if (error) {
      if (error.code === '23505') {
        const m = error.message
        setFormError(
          /ghana_card/.test(m) ? 'Another staff record already has this Ghana Card number.'
          : /ssnit/.test(m) ? 'Another staff record already has this SSNIT number.'
          : /health_ins/.test(m) ? 'Another staff record already has this health insurance number.'
          : 'This staff member is already recorded.',
        )
      } else setFormError(error.message)
      return
    }
    const wasEdit = modal?.mode === 'edit'
    setModal(null)
    showToast('ok', wasEdit ? `${name} updated.` : `${name} added.`)
    void load()
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    const { error } = await supabase.from('staff_particulars').delete().eq('id', toDelete.id)
    setDeleting(false)
    if (error) {
      showToast('error', error.message)
      return
    }
    showToast('ok', `${toDelete.full_name} deleted.`)
    setToDelete(null)
    void load()
  }

  /* ---------- render ---------- */

  const th = 'whitespace-nowrap border-b border-royal-700 bg-royal-600 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white'
  const td = 'whitespace-nowrap border-b border-gray-100 px-3 py-2.5 text-sm text-gray-700'
  const dash = <span className="text-gray-300">—</span>

  const statCards = [
    { icon: Users, label: 'Total staff', value: String(stats.total), sub: 'on record', tint: 'bg-royal-50 text-royal-600' },
    { icon: GraduationCap, label: 'Teaching staff', value: String(stats.teaching), sub: 'class and subject teachers', tint: 'bg-violet-50 text-violet-600' },
    { icon: UserCheck, label: 'Non-teaching staff', value: String(stats.nonTeaching), sub: 'admin, bursar, kitchen, security', tint: 'bg-sky-50 text-sky-600' },
    { icon: Users, label: 'Male / Female', value: `${stats.male} / ${stats.female}`, sub: 'by gender', tint: 'bg-pink-50 text-pink-600' },
    { icon: ClipboardList, label: 'Incomplete records', value: String(stats.incomplete), sub: stats.incomplete ? 'details still to collect' : 'all details collected', tint: stats.incomplete ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600' },
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <h1 className="text-2xl font-bold text-royal-900">Staff Particulars</h1>
      <p className="mt-1 text-sm text-gray-500">Personal and employment details of every member of staff. Only you and the admin can see this page.</p>

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {statCards.map(({ icon: Icon, label, value, sub, tint }) => (
          <div key={label} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-500">{label}</p>
              <p className="text-xl font-bold leading-tight text-royal-900">{loading ? '–' : value}</p>
              <p className="truncate text-[11px] text-gray-400">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, duty, class, subject, contact, ID number..."
            className={`${inputClass} pl-9`}
            aria-label="Search staff"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold ${activeFilters ? 'border-royal-500 bg-royal-50 text-royal-700' : 'border-gray-300 bg-white text-royal-900 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filter
            {activeFilters > 0 && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-royal-600 px-1 text-[11px] font-bold text-white">{activeFilters}</span>}
          </button>
          {showFilters && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowFilters(false)} />
              <div className="absolute right-0 top-full z-30 mt-2 w-72 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
                {[
                  { key: 'duty', label: 'Duty', options: DUTIES.map((d) => [d.value, d.label]) },
                  { key: 'level', label: 'Level', options: LEVELS.map((l) => [l.value, l.label]) },
                  { key: 'gender', label: 'Gender', options: [['male', 'Male'], ['female', 'Female']] },
                  { key: 'status', label: 'Status', options: STATUSES.map((s) => [s.value, s.label]) },
                  { key: 'records', label: 'Records', options: [['incomplete', 'Incomplete only']] },
                ].map((f) => (
                  <label key={f.key} className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {f.label}
                    <select
                      value={filters[f.key as keyof typeof filters]}
                      onChange={(e) => setFilters((x) => ({ ...x, [f.key]: e.target.value }))}
                      className={`${inputClass} mt-1 text-sm font-normal normal-case tracking-normal text-gray-700`}
                    >
                      <option value="all">All</option>
                      {f.options.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="flex justify-between pt-1">
                  <button onClick={() => setFilters(NO_FILTERS)} disabled={!activeFilters} className="text-sm font-semibold text-gray-500 hover:text-royal-700 disabled:opacity-40">Clear all</button>
                  <button onClick={() => setShowFilters(false)} className="rounded-lg bg-royal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal-700">Done</button>
                </div>
              </div>
            </>
          )}
        </div>

        <button onClick={openAdd} aria-label="Add staff" className="flex items-center gap-2 rounded-lg bg-royal-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-royal-700">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add staff</span>
        </button>
      </div>

      {toast && (
        <p className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${toast.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.type === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {toast.text}
        </p>
      )}
      {loadError && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {loadError}
        </p>
      )}

      <p className="mt-3 text-xs text-gray-500">
        {loading ? 'Loading...' : <>Showing <b className="text-royal-900">{visible.length}</b> of {rows.length} staff</>}
        {(activeFilters > 0 || search) && !loading && (
          <button onClick={() => { setSearch(''); setFilters(NO_FILTERS) }} className="ml-2 font-semibold text-royal-600 hover:underline">Clear search and filters</button>
        )}
      </p>

      {/* table */}
      <div className="mt-2 max-h-[68vh] overflow-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[2100px] border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className={`${th} sticky left-0 z-30 w-12 min-w-[3rem]`}>No.</th>
              <th className={`${th} sticky left-12 z-30 min-w-[13rem]`}>Name</th>
              <th className={th}>Date of birth</th>
              <th className={th}>Age</th>
              <th className={th}>Gender</th>
              <th className={th}>GPS address</th>
              <th className={th}>Hometown</th>
              <th className={th}>Contact</th>
              <th className={th}>Date appointed</th>
              <th className={th}>Years served</th>
              <th className={th}>Duty</th>
              <th className={th}>Class</th>
              <th className={th}>Level</th>
              <th className={th}>Subjects taught</th>
              <th className={th}>Ghana Card No.</th>
              <th className={th}>Health insurance No.</th>
              <th className={th}>SSNIT No.</th>
              <th className={th}>Email</th>
              <th className={th}>Qualification</th>
              <th className={th}>Licence No.</th>
              <th className={th}>Next of kin</th>
              <th className={th}>Status</th>
              <th className={`${th} sticky right-0 z-30 text-center`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={23} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-royal-600" /></td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={23} className="px-4 py-12 text-center text-sm text-gray-500">
                  {rows.length === 0 ? 'No staff recorded yet. Tap the + button to add the first one.' : 'No staff match your search or filters.'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => {
                const missing = missingOf(r)
                const st = STATUSES.find((s) => s.value === r.status)!
                const age = ageOf(r.date_of_birth)
                const subs = r.subjects ?? []
                return (
                  <tr key={r.id} className="group">
                    <td className={`${td} sticky left-0 z-10 bg-white text-gray-400 group-hover:bg-royal-50`}>{i + 1}</td>
                    <td className={`${td} sticky left-12 z-10 bg-white font-semibold uppercase text-royal-900 group-hover:bg-royal-50`}>
                      <span className="flex items-center gap-2">
                        {r.full_name}
                        {missing.length > 0 && (
                          <span title={`Still to collect: ${missing.join(', ')}`} className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label={`Incomplete: ${missing.join(', ')}`} />
                        )}
                      </span>
                    </td>
                    <td className={td}>{fmtDate(r.date_of_birth) || dash}</td>
                    <td className={td}>{age === null ? dash : age}</td>
                    <td className={td}>{r.gender ? (r.gender === 'male' ? 'Male' : 'Female') : dash}</td>
                    <td className={td}>{r.gps_address || dash}</td>
                    <td className={td}>{r.hometown || dash}</td>
                    <td className={td}>{r.contact || dash}</td>
                    <td className={td}>{fmtDate(r.date_appointed) || dash}</td>
                    <td className={td}>{servedText(r.date_appointed) || dash}</td>
                    <td className={td}>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isTeaching(r.duty) ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{dutyText(r)}</span>
                    </td>
                    <td className={td}>{r.duty === 'class_teacher' ? className(r.class_id) || dash : dash}</td>
                    <td className={td}>{levelLabel(levelOf(r)) || dash}</td>
                    <td className={td}>
                      {subs.length ? (
                        <span className="flex gap-1" title={subs.join(', ')}>
                          {subs.slice(0, 3).map((s) => (
                            <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{s}</span>
                          ))}
                          {subs.length > 3 && <span className="text-xs text-gray-400">+{subs.length - 3}</span>}
                        </span>
                      ) : dash}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{r.ghana_card_no || dash}</td>
                    <td className={`${td} font-mono text-xs`}>{r.health_insurance_no || dash}</td>
                    <td className={`${td} font-mono text-xs`}>{r.ssnit_no || dash}</td>
                    <td className={td}>{r.email || dash}</td>
                    <td className={td}>{r.qualification || dash}</td>
                    <td className={td}>{r.teacher_licence_no || dash}</td>
                    <td className={td}>
                      {r.next_of_kin_name || r.next_of_kin_contact ? (
                        <>{r.next_of_kin_name}{r.next_of_kin_contact && <span className="ml-1 text-gray-400">({r.next_of_kin_contact})</span>}</>
                      ) : dash}
                    </td>
                    <td className={td}>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${st.badge}`}>{st.label}</span>
                    </td>
                    <td className={`${td} sticky right-0 z-10 bg-white group-hover:bg-royal-50`}>
                      <span className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(r)} aria-label={`Edit ${r.full_name}`} title="Edit" className="rounded-md p-1.5 text-gray-500 hover:bg-royal-100 hover:text-royal-700">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setToDelete(r)} aria-label={`Delete ${r.full_name}`} title="Delete" className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">A yellow dot beside a name means some details are still to be collected. Hover over it to see which. Age and years served are worked out automatically.</p>

      {/* add / edit */}
      {modal && (
        <Modal title={modal.mode === 'edit' ? 'Edit staff particulars' : 'Add staff'} onClose={() => !saving && setModal(null)} wide>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Section title="Personal details">
              <Field label="Full name" wide>
                <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className={inputClass} placeholder="e.g. EZEKIEL KOFI ASIGBEY" autoFocus />
              </Field>
              <Field label="Date of birth" hint={form.date_of_birth ? <>Age: <b>{ageOf(form.date_of_birth)}</b> years</> : 'Age is worked out from this.'}>
                <input type="date" max={todayISO()} value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Gender">
                <select value={form.gender} onChange={(e) => set('gender', e.target.value as Form['gender'])} className={inputClass}>
                  <option value="">Choose...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </Field>
              <Field label="GPS address">
                <input value={form.gps_address} onChange={(e) => set('gps_address', e.target.value)} className={inputClass} placeholder="e.g. GA-123-4567" />
              </Field>
              <Field label="Hometown">
                <input value={form.hometown} onChange={(e) => set('hometown', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Contact">
                <input inputMode="tel" value={form.contact} onChange={(e) => set('contact', e.target.value)} className={inputClass} placeholder="e.g. 0244123456" />
              </Field>
              <Field label="Email">
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
              </Field>
            </Section>

            <Section title="Employment">
              <Field label="Date appointed" hint={form.date_appointed ? <>Years served: <b>{servedText(form.date_appointed)}</b></> : 'Years served is worked out from this.'}>
                <input type="date" max={todayISO()} value={form.date_appointed} onChange={(e) => set('date_appointed', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set('status', e.target.value as Status)} className={inputClass}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Duty" wide={form.duty !== 'other'}>
                <select value={form.duty} onChange={(e) => set('duty', e.target.value as Duty)} className={inputClass}>
                  <option value="">Choose the duty...</option>
                  {DUTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              {form.duty === 'other' && (
                <Field label="What is the duty?">
                  <input value={form.duty_other} onChange={(e) => set('duty_other', e.target.value)} className={inputClass} placeholder="e.g. Driver, Cleaner" />
                </Field>
              )}

              {form.duty === 'class_teacher' && (
                <>
                  <Field label="Class" hint={sameClassTeacher ? <span className="text-amber-700">{sameClassTeacher.full_name} is already recorded as class teacher of this class.</span> : undefined}>
                    <select value={form.class_id} onChange={(e) => set('class_id', e.target.value)} className={inputClass}>
                      <option value="">Choose a class...</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Level">
                    <input value={levelLabel(formClassLevel) || 'Set by the class'} readOnly className={`${inputClass} bg-gray-50 text-gray-500`} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                    <input type="checkbox" checked={form.also_subjects} onChange={(e) => set('also_subjects', e.target.checked)} className="h-4 w-4 accent-royal-600" />
                    Also teaches subjects
                  </label>
                </>
              )}

              {form.duty === 'subject_teacher' && (
                <Field label="Level" wide>
                  <select value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value, subjects: [] }))} className={inputClass}>
                    <option value="">Choose the level...</option>
                    {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </Field>
              )}

              {showSubjects && (
                <div className="sm:col-span-2">
                  <p className="text-sm font-medium text-royal-900">Subjects taught</p>
                  {!formLevel ? (
                    <p className="mt-1 text-xs text-gray-500">{form.duty === 'class_teacher' ? 'Choose the class first to see its subjects.' : 'Choose the level first to see its subjects.'}</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {subjectOptions.length === 0 && <p className="text-xs text-gray-500">No subjects are set up for this level yet. Add them below.</p>}
                      {subjectOptions.map((s) => {
                        const on = form.subjects.includes(s)
                        return (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSubject(s)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${on ? 'border-royal-600 bg-royal-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:border-royal-400'}`}
                          >
                            {s}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSubject() } }}
                      className={inputClass}
                      placeholder="Another subject not listed"
                    />
                    <button type="button" onClick={addCustomSubject} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-royal-900 hover:bg-gray-50">Add</button>
                  </div>
                </div>
              )}

              <Field label="Highest qualification">
                <input value={form.qualification} onChange={(e) => set('qualification', e.target.value)} className={inputClass} placeholder="e.g. B.Ed Basic Education" />
              </Field>
              {isTeaching(form.duty as Duty) && (
                <Field label="Teacher licence No.">
                  <input value={form.teacher_licence_no} onChange={(e) => set('teacher_licence_no', e.target.value)} className={inputClass} />
                </Field>
              )}
            </Section>

            <Section title="Identification numbers">
              <Field label="Ghana Card No." hint="Format: GHA-000000000-0">
                <input value={form.ghana_card_no} onChange={(e) => set('ghana_card_no', e.target.value)} className={`${inputClass} font-mono`} placeholder="GHA-000000000-0" />
              </Field>
              <Field label="Health insurance No.">
                <input value={form.health_insurance_no} onChange={(e) => set('health_insurance_no', e.target.value)} className={`${inputClass} font-mono`} />
              </Field>
              <Field label="SSNIT No.">
                <input value={form.ssnit_no} onChange={(e) => set('ssnit_no', e.target.value)} className={`${inputClass} font-mono`} />
              </Field>
            </Section>

            <Section title="Next of kin">
              <Field label="Name">
                <input value={form.next_of_kin_name} onChange={(e) => set('next_of_kin_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Contact">
                <input inputMode="tel" value={form.next_of_kin_contact} onChange={(e) => set('next_of_kin_contact', e.target.value)} className={inputClass} />
              </Field>
            </Section>
          </div>

          <div className="border-t border-gray-100 px-5 py-3">
            {formError && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60">Cancel</button>
              <button onClick={() => void save()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : modal.mode === 'edit' ? 'Save changes' : 'Add staff'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* delete */}
      {toDelete && (
        <Modal title="Delete this record?" onClose={() => !deleting && setToDelete(null)}>
          <div className="px-5 py-4">
            <p className="text-sm text-gray-600">
              <b className="text-royal-900">{toDelete.full_name}</b> and all their particulars will be removed. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setToDelete(null)} disabled={deleting} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60">Cancel</button>
              <button onClick={() => void confirmDelete()} disabled={deleting} className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}