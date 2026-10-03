import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  GraduationCap,
  Mars,
  Venus,
  ClipboardCheck,
  Bell,
  ChevronRight,
  FileText,
  ClipboardList,
  QrCode,
  Database,
  Award,
  BookOpen,
  Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

const LEVEL_META: Record<string, { label: string; solid: string; soft: string; text: string }> = {
  creche: { label: 'Creche', solid: 'bg-pink-500', soft: 'bg-pink-50', text: 'text-pink-700' },
  nursery: { label: 'Nursery', solid: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700' },
  kg: { label: 'KG', solid: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  lower_primary: { label: 'Lower Primary', solid: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  upper_primary: { label: 'Upper Primary', solid: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700' },
  jhs: { label: 'JHS', solid: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700' },
}
const DEFAULT_LEVEL = { label: '', solid: 'bg-royal-600', soft: 'bg-royal-50', text: 'text-royal-700' }

const CLASS_TEACHER_ACTIONS = [
  { label: 'My Class', desc: 'View your students', to: '/teacher/class', icon: Users },
  { label: 'Attendance', desc: "Take today's register", to: '/teacher/attendance', icon: ClipboardCheck },
  { label: 'Score Bank', desc: 'Record task and test scores', to: '/teacher/score-bank', icon: Database },
  { label: 'Exams', desc: 'Enter exam scores', to: '/teacher/exams', icon: FileText },
  { label: 'SBA', desc: 'Compute SBA results', to: '/teacher/sba', icon: ClipboardList },
  { label: 'Clock In', desc: 'Mark your attendance', to: '/teacher/clock-in', icon: QrCode },
  { label: 'Alerts', desc: 'School announcements', to: '/teacher/alerts', icon: Bell },
]

const SUBJECT_TEACHER_ACTIONS = [
  { label: 'Score Bank', desc: 'Record task and test scores', to: '/teacher/score-bank', icon: Database },
  { label: 'Exams', desc: 'Enter exam scores', to: '/teacher/exams', icon: FileText },
  { label: 'SBA', desc: 'Compute SBA results', to: '/teacher/sba', icon: ClipboardList },
  { label: 'Clock In', desc: 'Mark your attendance', to: '/teacher/clock-in', icon: QrCode },
  { label: 'Alerts', desc: 'School announcements', to: '/teacher/alerts', icon: Bell },
]

interface SubjectRow {
  subject: string
  class: { name: string } | null
}

function greeting(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
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
    return (
      <img
        src={url}
        alt=""
        className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-lg"
      />
    )
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
  sub,
  icon,
  loading,
  accentSolid,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  loading: boolean
  accentSolid: string
}) {
  // Long values (like class names) wrap onto two lines at a slightly smaller size instead of being cut off
  const isLong = String(value).length > 10

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${accentSolid}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-14 animate-pulse rounded bg-gray-200" />
          ) : (
            <>
              <p
                className={`break-words font-bold leading-tight text-royal-900 ${
                  isLong ? 'text-base' : 'text-xl'
                }`}
              >
                {value}
              </p>
              {sub && <p className="mt-0.5 text-xs font-medium text-gray-400">{sub}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ClassMakeupCard({
  boys,
  girls,
  total,
  loading,
}: {
  boys: number
  girls: number
  total: number
  loading: boolean
}) {
  const boysPct = total ? (boys / total) * 100 : 0
  const girlsPct = total ? (girls / total) * 100 : 0

  return (
    <div className="col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between text-sm">
        <p className="font-semibold text-royal-900">Class makeup</p>
        {!loading && <p className="text-xs text-gray-500">{total} {total === 1 ? 'student' : 'students'}</p>}
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

function QuickActionsGrid({ actions }: { actions: typeof CLASS_TEACHER_ACTIONS }) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-royal-900">Quick actions</h2>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {actions.map((a) => (
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
  )
}

function SubjectsPanel({ subjects, accentSolid }: { subjects: SubjectRow[]; accentSolid: string }) {
  if (subjects.length === 0) return null
  return (
    <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
        <BookOpen className="h-4 w-4 text-royal-500" />
        My subjects
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {subjects.map((s, i) => (
          <span
            key={`${s.subject}-${s.class?.name}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-royal-900"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${accentSolid}`} />
            {s.subject}
            {s.class?.name && <span className="text-gray-400">· {s.class.name}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function TeacherDashboard() {
  const { profile } = useAuth()
  const [className, setClassName] = useState<string | null>(null)
  const [levelGroup, setLevelGroup] = useState<string | null>(null)
  const [studentCount, setStudentCount] = useState(0)
  const [boys, setBoys] = useState(0)
  const [girls, setGirls] = useState(0)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectClassCount, setSubjectClassCount] = useState(0)
  const [subjectStudentCount, setSubjectStudentCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      if (!profile) return
      const [classRes, subjectRes] = await Promise.all([
        supabase.from('classes').select('id, name, level_group').eq('teacher_id', profile.id).maybeSingle(),
        supabase
          .from('subject_assignments')
          .select('subject, class_id, class:classes(name, level_group)')
          .eq('teacher_id', profile.id),
      ])

      if (!active) return

      const subjectRows = (subjectRes.data as unknown as (SubjectRow & { class_id: string })[]) ?? []
      setSubjects(subjectRows)

      const myClass = classRes.data
      if (myClass) {
        setClassName(myClass.name)
        setLevelGroup(myClass.level_group)
        const { data: students } = await supabase
          .from('students')
          .select('id, gender')
          .eq('class_id', myClass.id)
          .eq('is_active', true)
        if (!active) return
        const list = students ?? []
        setStudentCount(list.length)
        setBoys(list.filter((s) => s.gender === 'male').length)
        setGirls(list.filter((s) => s.gender === 'female').length)
      } else if (subjectRows.length > 0) {
        const classIds = Array.from(new Set(subjectRows.map((r) => r.class_id)))
        setSubjectClassCount(classIds.length)
        const firstLevel = (subjectRows[0] as unknown as { class: { level_group: string | null } | null }).class?.level_group
        setLevelGroup(firstLevel ?? null)
        if (classIds.length > 0) {
          const { count } = await supabase
            .from('students')
            .select('id', { count: 'exact', head: true })
            .in('class_id', classIds)
            .eq('is_active', true)
          if (active) setSubjectStudentCount(count ?? 0)
        }
      }
      setLoading(false)
    }

    load()
    return () => {
      active = false
    }
  }, [profile])

  const now = new Date()
  const firstName = (profile?.full_name || profile?.email || '').split(' ')[0]
  const dateText = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const isClassTeacher = !!className
  const isSubjectTeacher = subjects.length > 0
  const level = LEVEL_META[levelGroup ?? ''] ?? DEFAULT_LEVEL
  const initials = (profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-royal-700 via-royal-600 to-royal-500 px-6 pb-16 pt-6 text-white shadow-lg sm:pb-20">
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-royal-100">{dateText}</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              {greeting(now.getHours())}, <span className="text-gold-400">{firstName || 'Teacher'}</span>
            </h1>
            <div className="mt-3 h-1 w-20 rounded bg-royal-300" />
            <p className="mt-3 text-sm text-royal-100">
              {isClassTeacher && isSubjectTeacher
                ? 'Class teacher & subject teacher'
                : isClassTeacher
                ? 'Class teacher'
                : isSubjectTeacher
                ? 'Subject teacher'
                : "Here's your SAT ROYAL HUB overview."}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {isClassTeacher && (
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-royal-900 shadow-md">
                  <GraduationCap className="h-4 w-4" />
                  {className}
                </span>
              )}
              {level.label && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white ${level.solid}`}>
                  {level.label}
                </span>
              )}
            </div>
          </div>

          <div className="relative hidden shrink-0 sm:block">
            <HeroAvatar url={profile?.avatar_url ?? null} initials={initials} />
          </div>
        </div>

        <HeroWave />
      </div>

      {/* Class teacher stats */}
      {isClassTeacher && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="My class"
            value={className || ''}
            sub={level.label || undefined}
            loading={loading}
            accentSolid={level.solid}
            icon={<GraduationCap className="h-5 w-5" />}
          />
          <StatCard
            label="Students"
            value={studentCount}
            loading={loading}
            accentSolid="bg-royal-600"
            icon={<Users className="h-5 w-5" />}
          />
          <ClassMakeupCard boys={boys} girls={girls} total={studentCount} loading={loading} />
        </div>
      )}

      {/* Subject-only teacher stats */}
      {!isClassTeacher && isSubjectTeacher && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Subjects" value={subjects.length} loading={loading} accentSolid={level.solid} icon={<BookOpen className="h-5 w-5" />} />
          <StatCard label="Classes you teach" value={subjectClassCount} loading={loading} accentSolid="bg-royal-600" icon={<GraduationCap className="h-5 w-5" />} />
          <StatCard label="Students reached" value={subjectStudentCount} loading={loading} accentSolid="bg-sky-600" icon={<Users className="h-5 w-5" />} />
        </div>
      )}

      {/* Quick actions — different set per role */}
      <QuickActionsGrid actions={isClassTeacher ? CLASS_TEACHER_ACTIONS : SUBJECT_TEACHER_ACTIONS} />

      {/* Subjects list (shown for any teacher with subject assignments, including hybrid class+subject teachers) */}
      <SubjectsPanel subjects={subjects} accentSolid={level.solid} />

      {/* Class-teacher-only: Master Result */}
      {isClassTeacher && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
            <Sparkles className="h-4 w-4 text-royal-500" />
            More on SAT ROYAL HUB
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Link
  to="/teacher/master-result"
  className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-md"
>
  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-royal-50 text-royal-600 transition-colors group-hover:bg-royal-600 group-hover:text-white">
    <Award className="h-5 w-5" />
  </div>
  <p className="mt-3 text-sm font-semibold text-royal-900">Master Result</p>
  <p className="mt-0.5 text-xs text-gray-500">All subjects, totals and positions</p>
  <ChevronRight className="absolute right-3 top-4 h-4 w-4 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-royal-500" />
</Link>
          </div>
        </div>
      )}

      {!loading && !isClassTeacher && !isSubjectTeacher && (
        <div className="mt-6 rounded-2xl border-l-4 border-royal-500 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">
            You haven't been assigned a class or subject yet. Contact your administrator.
          </p>
        </div>
      )}
    </div>
  )
}