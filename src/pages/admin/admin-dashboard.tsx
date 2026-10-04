import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  GraduationCap,
  School,
  Mars,
  Venus,
  FileText,
  Bell,
  BookOpen,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  UserCog,
  Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

// ---- Edit these to match the routes you have built ----
const ADMIN_ACTIONS = [
  { label: 'Teachers', desc: 'Manage teacher accounts', to: '/admin/teachers', icon: Users },
  { label: 'Classes', desc: 'Classes and class teachers', to: '/admin/class', icon: School },
  { label: 'Students', desc: 'Enrol and manage students', to: '/admin/students', icon: GraduationCap },
  { label: 'Subjects', desc: 'Subjects for each level', to: '/admin/subjects', icon: BookOpen },
  { label: 'Exams', desc: 'Activate exam windows', to: '/admin/exams', icon: FileText },
  { label: 'Alerts', desc: 'Send announcements', to: '/admin/alerts', icon: Bell },
  { label: 'Non-Staff', desc: 'Bursar, headteacher and other staff', to: '/admin/non-staff', icon: UserCog },
  { label: 'Fees', desc: 'Fee amounts and opening balances', to: '/admin/fees', icon: Wallet },
]
const EXAMS_ROUTE = '/admin/exams'
// --------------------------------------------------------

const TERMS = ['Term 1', 'Term 2', 'Term 3']

const LEVEL_META: Record<string, { label: string; solid: string }> = {
  creche: { label: 'Creche', solid: 'bg-pink-500' },
  nursery: { label: 'Nursery', solid: 'bg-orange-500' },
  kg: { label: 'KG', solid: 'bg-amber-500' },
  lower_primary: { label: 'Lower Primary', solid: 'bg-emerald-500' },
  upper_primary: { label: 'Upper Primary', solid: 'bg-sky-500' },
  jhs: { label: 'JHS', solid: 'bg-violet-500' },
}

const GROUP_LABEL: Record<string, string> = {
  creche_nursery: 'Creche - Nursery',
  kg_basic6: 'KG - Basic 6',
  jhs: 'JHS (Basic 7-9)',
}

interface ProfileRow {
  id: string
  full_name: string | null
  email: string | null
  role: string
  is_active: boolean
}
interface ClassRow {
  id: string
  name: string
  level_group: string | null
  teacher_id: string | null
}
interface StudentRow {
  class_id: string | null
  gender: string | null
}
interface AssignmentRow {
  teacher_id: string
}
interface ExamRow {
  id: string
  group_key: string
  exam_type: string
  term: string
  start_date: string
  end_date: string
  is_active: boolean
  class_ids: string[] | null
}
interface NonStaffRow {
  is_active: boolean
}
interface SubjectRow {
  name: string
  level_group: string
}
interface ConfigRow {
  class_id: string
  subject: string
}

function greeting(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function defaultTerm() {
  const m = new Date().getMonth() + 1
  if (m >= 9) return 'Term 1'
  if (m <= 4) return 'Term 2'
  return 'Term 3'
}

function todayIso() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function examStatus(start: string, end: string) {
  const today = todayIso()
  if (today < start) return { label: 'Upcoming', cls: 'bg-sky-50 text-sky-700', order: 1 }
  if (today > end) return { label: 'Ended', cls: 'bg-gray-100 text-gray-500', order: 2 }
  return { label: 'Open now', cls: 'bg-green-50 text-green-700', order: 0 }
}

function HeroWave() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 leading-[0]">
      <svg viewBox="0 0 1440 120" className="h-14 w-full text-royal-900/30 sm:h-16" preserveAspectRatio="none">
        <path fill="currentColor" d="M0,48 C240,90 480,10 720,32 C960,54 1200,100 1440,64 L1440,120 L0,120 Z" />
      </svg>
      <svg viewBox="0 0 1440 120" className="-mt-10 h-12 w-full text-gold-400 sm:-mt-12 sm:h-14" preserveAspectRatio="none">
        <path fill="currentColor" d="M0,64 C240,32 480,92 720,76 C960,60 1200,16 1440,48 L1440,120 L0,120 Z" />
      </svg>
    </div>
  )
}

function HeroAvatar({ url, initials }: { url: string | null; initials: string }) {
  if (url) {
    return <img src={url} alt="" className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-lg" />
  }
  return (
    <span className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-royal-800 text-2xl font-bold text-white shadow-lg">
      {initials}
    </span>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  accent,
}: {
  label: string
  value: number
  icon: typeof Users
  loading: boolean
  accent: string
}) {
  return (
    <div className="group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2.5 transition-transform duration-200 group-hover:scale-110 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-10 animate-pulse rounded bg-gray-200" />
          ) : (
            <p className="text-xl font-bold text-royal-900">{value}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function MakeupCard({ boys, girls, total, loading }: { boys: number; girls: number; total: number; loading: boolean }) {
  const boysPct = total ? (boys / total) * 100 : 0
  const girlsPct = total ? (girls / total) * 100 : 0

  return (
    <div className="col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between text-sm">
        <p className="font-semibold text-royal-900">School makeup</p>
        {!loading && (
          <p className="text-xs text-gray-500">
            {total} {total === 1 ? 'student' : 'students'}
          </p>
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-3">
          <div className="h-11 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-3 animate-pulse rounded-full bg-gray-100" />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
                <Mars className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Boys</p>
                <p className="text-xl font-bold leading-tight text-royal-900">
                  {boys} <span className="text-xs font-medium text-gray-400">{Math.round(boysPct)}%</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pink-500 text-white">
                <Venus className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Girls</p>
                <p className="text-xl font-bold leading-tight text-royal-900">
                  {girls} <span className="text-xs font-medium text-gray-400">{Math.round(girlsPct)}%</span>
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${boysPct}%` }} />
            <div className="h-full bg-pink-500 transition-all" style={{ width: `${girlsPct}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [students, setStudents] = useState<StudentRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [exams, setExams] = useState<ExamRow[]>([])
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [nonStaff, setNonStaff] = useState<NonStaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadIssue, setLoadIssue] = useState(false)

  const [term, setTerm] = useState(defaultTerm)
  const [configs, setConfigs] = useState<ConfigRow[] | null>([])

  useEffect(() => {
    let active = true

    async function load() {
      const [p, c, s, a, e, sub, ns] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role, is_active'),
        supabase.from('classes').select('id, name, level_group, teacher_id'),
        supabase.from('students').select('class_id, gender').eq('is_active', true),
        supabase.from('subject_assignments').select('teacher_id'),
        supabase
          .from('exam_sessions')
          .select('id, group_key, exam_type, term, start_date, end_date, is_active, class_ids')
          .eq('is_active', true),
        supabase.from('subjects').select('name, level_group'),
        supabase.from('non_teaching_staff').select('is_active'),
      ])

      if (!active) return

      setLoadIssue(!!(p.error || c.error || s.error || a.error || e.error || sub.error))
      setProfiles((p.data as ProfileRow[]) ?? [])
      setClasses((c.data as ClassRow[]) ?? [])
      setStudents((s.data as StudentRow[]) ?? [])
      setAssignments((a.data as AssignmentRow[]) ?? [])
      setExams((e.data as ExamRow[]) ?? [])
      setSubjects((sub.data as SubjectRow[]) ?? [])
      setNonStaff((ns.data as NonStaffRow[]) ?? [])
      setLoading(false)
    }

    load()
    return () => {
      active = false
    }
  }, [])

  // SBA setups for the chosen term (one row per class and subject)
  useEffect(() => {
    let active = true
    async function loadConfigs() {
      const { data, error } = await supabase.from('sba_configs').select('class_id, subject').eq('term', term)
      if (!active) return
      setConfigs(error ? null : ((data as ConfigRow[]) ?? []))
    }
    loadConfigs()
    return () => {
      active = false
    }
  }, [term])

  const view = useMemo(() => {
    const teachers = profiles.filter((p) => p.role === 'teacher')
    const admins = profiles.filter((p) => p.role === 'admin')
    const activeTeachers = teachers.filter((t) => t.is_active)
    const teacherById = new Map(teachers.map((t) => [t.id, t]))
    const nameOf = (t: ProfileRow) => t.full_name || t.email || 'Unnamed teacher'

    let boys = 0
    let girls = 0
    let unplaced = 0
    const byClass = new Map<string, { total: number; boys: number; girls: number }>()
    for (const s of students) {
      if (s.gender === 'male') boys++
      else if (s.gender === 'female') girls++
      if (!s.class_id) {
        unplaced++
        continue
      }
      const c = byClass.get(s.class_id) ?? { total: 0, boys: 0, girls: 0 }
      c.total++
      if (s.gender === 'male') c.boys++
      else if (s.gender === 'female') c.girls++
      byClass.set(s.class_id, c)
    }

    const expectedByLevel = new Map<string, Set<string>>()
    for (const s of subjects) {
      const set = expectedByLevel.get(s.level_group) ?? new Set<string>()
      set.add(s.name)
      expectedByLevel.set(s.level_group, set)
    }

    const doneByClass = new Map<string, Set<string>>()
    for (const cfg of configs ?? []) {
      const set = doneByClass.get(cfg.class_id) ?? new Set<string>()
      set.add(cfg.subject)
      doneByClass.set(cfg.class_id, set)
    }

    const sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const classById = new Map(classes.map((c) => [c.id, c]))

    const classRows = sortedClasses.map((c) => {
      const teacher = c.teacher_id ? teacherById.get(c.teacher_id) ?? null : null
      const counts = byClass.get(c.id) ?? { total: 0, boys: 0, girls: 0 }
      const expected = c.level_group ? expectedByLevel.get(c.level_group)?.size ?? 0 : 0
      const done = doneByClass.get(c.id)?.size ?? 0
      return { cls: c, teacher, counts, expected, done }
    })

    // Things that need the admin's attention
    const attention: { key: string; title: string; detail: string }[] = []

    const noTeacher = classRows.filter((r) => !r.teacher).map((r) => r.cls.name)
    if (noTeacher.length > 0) {
      attention.push({ key: 'no-teacher', title: 'Classes without a class teacher', detail: noTeacher.join(', ') })
    }

    const inactiveClassTeacher = classRows.filter((r) => r.teacher && !r.teacher.is_active)
    if (inactiveClassTeacher.length > 0) {
      attention.push({
        key: 'inactive-teacher',
        title: 'Class teacher account is inactive',
        detail: inactiveClassTeacher.map((r) => `${r.cls.name} (${nameOf(r.teacher as ProfileRow)})`).join(', '),
      })
    }

    const emptyClasses = classRows.filter((r) => r.counts.total === 0).map((r) => r.cls.name)
    if (emptyClasses.length > 0) {
      attention.push({ key: 'empty', title: 'Classes with no students', detail: emptyClasses.join(', ') })
    }

    const classTeacherIds = new Set(classes.map((c) => c.teacher_id).filter((id): id is string => !!id))
    const assignedIds = new Set(assignments.map((a) => a.teacher_id))
    const unassigned = activeTeachers.filter((t) => !classTeacherIds.has(t.id) && !assignedIds.has(t.id)).map(nameOf)
    if (unassigned.length > 0) {
      attention.push({ key: 'unassigned', title: 'Active teachers with no class or subject', detail: unassigned.join(', ') })
    }

    if (unplaced > 0) {
      attention.push({
        key: 'unplaced',
        title: 'Students not placed in a class',
        detail: `${unplaced} active ${unplaced === 1 ? 'student has' : 'students have'} no class.`,
      })
    }

    const openExams = exams
      .map((e) => ({ exam: e, status: examStatus(e.start_date, e.end_date) }))
      .sort((a, b) => a.status.order - b.status.order || b.exam.start_date.localeCompare(a.exam.start_date))

    return {
      totalTeachers: teachers.length,
      activeTeachers: activeTeachers.length,
      inactiveTeachers: teachers.length - activeTeachers.length,
      totalAdmins: admins.length,
      totalNonStaff: nonStaff.length,
      totalStudents: students.length,
      boys,
      girls,
      classRows,
      classById,
      attention,
      openExams,
    }
  }, [profiles, classes, students, assignments, exams, subjects, configs, nonStaff])

  const now = new Date()
  const firstName = (profile?.full_name || profile?.email || '').split(' ')[0]
  const dateText = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const initials = (profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-royal-700 via-royal-600 to-royal-500 px-6 pb-16 pt-6 text-white shadow-lg sm:pb-20">
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-royal-100">{dateText}</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              {greeting(now.getHours())}, <span className="text-gold-400">{firstName || 'Admin'}</span>
            </h1>
            <div className="mt-3 h-1 w-20 rounded bg-royal-300" />
            <p className="mt-3 text-sm text-royal-100">Here's an overview of SAT ROYAL HUB.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-royal-900 shadow-md">
                <ShieldCheck className="h-4 w-4" />
                Administrator
              </span>
            </div>
          </div>
          <div className="relative hidden shrink-0 sm:block">
            <HeroAvatar url={profile?.avatar_url ?? null} initials={initials} />
          </div>
        </div>
        <HeroWave />
      </div>

      {loadIssue && !loading && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Some figures could not be loaded, so parts of this page may be incomplete. Check your table permissions.</p>
        </div>
      )}

      {/* People */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total teachers" value={view.totalTeachers} icon={Users} loading={loading} accent="bg-royal-50 text-royal-600" />
        <StatCard label="Active teachers" value={view.activeTeachers} icon={UserCheck} loading={loading} accent="bg-green-50 text-green-600" />
        <StatCard label="Inactive teachers" value={view.inactiveTeachers} icon={UserX} loading={loading} accent="bg-red-50 text-red-600" />
        <StatCard label="Admins" value={view.totalAdmins} icon={ShieldCheck} loading={loading} accent="bg-gold-400/20 text-gold-500" />
        <StatCard label="Non-teaching staff" value={view.totalNonStaff} icon={UserCog} loading={loading} accent="bg-sky-50 text-sky-600" />
      </div>

      {/* School */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Students" value={view.totalStudents} icon={GraduationCap} loading={loading} accent="bg-sky-50 text-sky-600" />
        <StatCard label="Classes" value={view.classRows.length} icon={School} loading={loading} accent="bg-violet-50 text-violet-600" />
        <MakeupCard boys={view.boys} girls={view.girls} total={view.totalStudents} loading={loading} />
      </div>

      {/* Quick actions */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-royal-900">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {ADMIN_ACTIONS.map((a) => (
            <Link
              key={a.label}
              to={a.to}
              className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-royal-50 text-royal-600 transition-colors group-hover:bg-royal-600 group-hover:text-white">
                <a.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-royal-900">{a.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{a.desc}</p>
              <ChevronRight className="absolute right-3 top-4 h-4 w-4 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-royal-500" />
            </Link>
          ))}
        </div>
      </div>

      {/* Exams + attention */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
              <CalendarClock className="h-4 w-4 text-royal-500" />
              Active exams
            </h2>
            <Link to={EXAMS_ROUTE} className="text-xs font-medium text-royal-600 hover:underline">
              Manage exams
            </Link>
          </div>

          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-gray-100" />
          ) : view.openExams.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">No exams are activated right now.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {view.openExams.slice(0, 6).map(({ exam, status }) => {
                const classNames =
                  exam.class_ids && exam.class_ids.length > 0
                    ? exam.class_ids.map((id) => view.classById.get(id)?.name).filter(Boolean).join(', ')
                    : ''
                return (
                  <li key={exam.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-royal-900">{exam.exam_type}</p>
                      <p className="text-xs text-gray-500">
                        {GROUP_LABEL[exam.group_key] ?? exam.group_key} · {exam.term}
                      </p>
                      <p className="text-xs text-gray-400">
                        {shortDate(exam.start_date)} → {shortDate(exam.end_date)}
                        {classNames && ` · ${classNames}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Needs attention
          </h2>

          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-gray-100" />
          ) : view.attention.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All set. Nothing needs your attention.
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {view.attention.map((item) => (
                <li key={item.key} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                  <p className="text-sm font-medium text-amber-900">{item.title}</p>
                  <p className="mt-0.5 text-xs text-amber-800">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Classes overview */}
      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-royal-900">Classes overview</h2>
          <div>
            <label className="block text-xs font-medium text-gray-500">SBA progress for</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Class teacher</th>
                <th className="px-4 py-3">Students</th>
                <th className="px-4 py-3">SBAs set up</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : view.classRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                    No classes yet.
                  </td>
                </tr>
              ) : (
                view.classRows.map(({ cls, teacher, counts, expected, done }) => {
                  const level = cls.level_group ? LEVEL_META[cls.level_group] : null
                  const pct = expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0
                  return (
                    <tr key={cls.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 font-semibold text-royal-900">{cls.name}</td>
                      <td className="px-4 py-3">
                        {level ? (
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${level.solid}`}>
                            {level.label}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {teacher ? (
                          <span className={teacher.is_active ? 'text-royal-900' : 'text-red-600'}>
                            {teacher.full_name || teacher.email}
                            {!teacher.is_active && ' (inactive)'}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">Not assigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-royal-900">{counts.total}</span>
                        {counts.total > 0 && (
                          <span className="ml-2 text-xs text-gray-400">
                            {counts.boys}B · {counts.girls}G
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {configs === null ? (
                          <span className="text-gray-300">—</span>
                        ) : expected > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full bg-royal-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-500">
                              {done}/{expected}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">{done} set up</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}