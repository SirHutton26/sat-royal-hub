import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  GraduationCap,
  Mars,
  Venus,
  BookOpen,
  ClipboardCheck,
  Bell,
  ChevronRight,
  HelpCircle,
  FileText,
  ClipboardList,
  QrCode,
  Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const QUICK_ACTIONS = [
  { label: 'My Class', desc: 'View your students', to: '/teacher/class', icon: Users },
  { label: 'Attendance', desc: "Take today's register", to: '/teacher/attendance', icon: ClipboardCheck },
  { label: 'Grades', desc: 'Enter and review marks', to: '/teacher/grades', icon: BookOpen },
  { label: 'Quizzes', desc: 'Create and score quizzes', to: '/teacher/quiz', icon: HelpCircle },
  { label: 'Exams', desc: 'Enter exam scores', to: '/teacher/exams', icon: FileText },
  { label: 'Clock In', desc: 'Mark your attendance', to: '/teacher/clock-in', icon: QrCode },
  { label: 'Alerts', desc: 'School announcements', to: '/teacher/alerts', icon: Bell },
]

const COMING_SOON_ITEMS = [
  { label: 'SBA', icon: ClipboardList },
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

function StatCard({
  label,
  value,
  icon,
  loading,
  accent,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  loading: boolean
  accent: 'royal' | 'gold'
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gold-400/30 bg-[#FFFBEF] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        className={`absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl transition-opacity group-hover:opacity-100 ${
          accent === 'gold' ? 'bg-gold-400/40 opacity-70' : 'bg-royal-500/20 opacity-60'
        }`}
      />
      <div className="relative flex items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            accent === 'gold' ? 'bg-gold-400 text-royal-900' : 'bg-royal-600 text-white'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-14 animate-pulse rounded bg-gold-400/30" />
          ) : (
            <p className="truncate text-xl font-bold text-royal-900">{value}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TeacherDashboard() {
  const { profile } = useAuth()
  const [className, setClassName] = useState<string | null>(null)
  const [studentCount, setStudentCount] = useState(0)
  const [boys, setBoys] = useState(0)
  const [girls, setGirls] = useState(0)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      if (!profile) return
      const [classRes, subjectRes] = await Promise.all([
        supabase.from('classes').select('id, name').eq('teacher_id', profile.id).maybeSingle(),
        supabase.from('subject_assignments').select('subject, class:classes(name)').eq('teacher_id', profile.id),
      ])

      if (!active) return
      setSubjects((subjectRes.data as unknown as SubjectRow[]) ?? [])

      const myClass = classRes.data
      if (myClass) {
        setClassName(myClass.name)
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
  const boysPct = studentCount ? (boys / studentCount) * 100 : 0
  const girlsPct = studentCount ? (girls / studentCount) * 100 : 0

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-royal-700 via-royal-600 to-royal-500 px-6 pb-16 pt-6 text-white shadow-lg sm:pb-20">
        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-gold-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 top-1/3 h-56 w-56 rounded-full bg-gold-500/15 blur-3xl" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-royal-100">{dateText}</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              {greeting(now.getHours())}, <span className="text-gold-400">{firstName || 'Teacher'}</span>
            </h1>
            <div className="mt-3 h-1 w-20 rounded bg-gold-400" />
            <p className="mt-3 text-sm text-royal-100">Here's your SAT ROYAL HUB overview.</p>

            {className && (
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold-400 px-3.5 py-1.5 text-xs font-bold text-royal-900 shadow-md">
                <GraduationCap className="h-4 w-4" />
                Class teacher · {className}
              </span>
            )}
          </div>

          <div className="relative hidden shrink-0 sm:block">
            <div className="absolute inset-0 -z-10 rounded-full bg-gold-400/40 blur-xl" />
            <img
              src={schoolLogo}
              alt=""
              className="h-20 w-20 rounded-full bg-gold-50 object-contain p-2 shadow-lg ring-4 ring-gold-400/50"
            />
          </div>
        </div>

        <HeroWave />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="My class"
          value={className || 'Unassigned'}
          loading={loading}
          accent="gold"
          icon={<GraduationCap className="h-5 w-5" />}
        />
        <StatCard label="Students" value={studentCount} loading={loading} accent="royal" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Boys" value={boys} loading={loading} accent="royal" icon={<Mars className="h-5 w-5" />} />
        <StatCard label="Girls" value={girls} loading={loading} accent="gold" icon={<Venus className="h-5 w-5" />} />
      </div>

      {/* Class makeup */}
      {!loading && studentCount > 0 && (
        <div className="mt-4 rounded-2xl border border-gold-400/30 bg-[#FFFBEF] p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <p className="font-semibold text-royal-900">Class makeup</p>
            <p className="text-xs text-gray-500">{studentCount} students</p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-royal-600 transition-all" style={{ width: `${boysPct}%` }} />
            <div className="h-full bg-gold-400 transition-all" style={{ width: `${girlsPct}%` }} />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-royal-600" />
              Boys {Math.round(boysPct)}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-gold-400" />
              Girls {Math.round(girlsPct)}%
            </span>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-royal-900">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.label}
              to={a.to}
              className="group relative overflow-hidden rounded-2xl border border-transparent bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gold-400 hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-royal-50 text-royal-600 transition-colors group-hover:bg-gold-400 group-hover:text-royal-900">
                <a.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-royal-900">{a.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{a.desc}</p>
              <ChevronRight className="absolute right-3 top-4 h-4 w-4 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-gold-500" />
              <span className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-gold-400 transition-transform duration-300 group-hover:scale-x-100" />
            </Link>
          ))}
        </div>
      </div>

      {/* Subjects */}
      {subjects.length > 0 && (
        <div className="mt-8 rounded-2xl border border-gold-400/30 bg-[#FFFBEF] p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
            <BookOpen className="h-4 w-4 text-gold-500" />
            My subjects
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {subjects.map((s, i) => (
              <span
                key={`${s.subject}-${s.class?.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/50 bg-white px-3 py-1 text-xs font-medium text-royal-900"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                {s.subject}
                {s.class?.name && <span className="text-gray-400">· {s.class.name}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Coming soon */}
      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-royal-900">
          <Sparkles className="h-4 w-4 text-gold-500" />
          More on SAT ROYAL HUB
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {COMING_SOON_ITEMS.map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gold-400/60 bg-white/60 p-4 text-center text-gray-400"
            >
              <item.icon className="h-6 w-6" />
              <p className="text-sm font-medium">{item.label}</p>
              <span className="rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-semibold text-gold-500">
                Coming soon
              </span>
            </div>
          ))}
        </div>
      </div>

      {!loading && !className && (
        <div className="mt-6 rounded-2xl border-l-4 border-gold-400 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">
            You haven't been assigned a class yet. Contact your administrator.
          </p>
        </div>
      )}
    </div>
  )
}