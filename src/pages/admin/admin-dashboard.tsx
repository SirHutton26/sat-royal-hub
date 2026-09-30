import { useEffect, useState } from 'react'
import { Users, UserCheck, UserX, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

interface Stats {
  totalTeachers: number
  activeTeachers: number
  inactiveTeachers: number
  totalAdmins: number
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
    <div className="group rounded-xl bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-3">
        <div
          className={`rounded-lg p-2.5 transition-transform duration-200 group-hover:scale-110 ${accent}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
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

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadStats() {
      const [teachersActive, teachersInactive, admins] = await Promise.all([
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'teacher')
          .eq('is_active', true),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'teacher')
          .eq('is_active', false),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin'),
      ])

      if (!active) return
      const activeCount = teachersActive.count ?? 0
      const inactiveCount = teachersInactive.count ?? 0
      setStats({
        totalTeachers: activeCount + inactiveCount,
        activeTeachers: activeCount,
        inactiveTeachers: inactiveCount,
        totalAdmins: admins.count ?? 0,
      })
      setLoading(false)
    }

    loadStats()
    return () => {
      active = false
    }
  }, [])

  return (
    <div>
      <div className="rounded-xl bg-gradient-to-r from-royal-600 to-royal-700 p-6 text-white shadow-sm">
        <h1 className="text-xl font-semibold">
          Welcome, {profile?.full_name || profile?.email}
        </h1>
        <p className="mt-1 text-sm text-royal-100">Here's an overview of SAT ROYAL HUB.</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total teachers"
          value={stats?.totalTeachers ?? 0}
          icon={Users}
          loading={loading}
          accent="bg-royal-50 text-royal-600"
        />
        <StatCard
          label="Active teachers"
          value={stats?.activeTeachers ?? 0}
          icon={UserCheck}
          loading={loading}
          accent="bg-green-50 text-green-600"
        />
        <StatCard
          label="Inactive teachers"
          value={stats?.inactiveTeachers ?? 0}
          icon={UserX}
          loading={loading}
          accent="bg-red-50 text-red-600"
        />
        <StatCard
          label="Admins"
          value={stats?.totalAdmins ?? 0}
          icon={ShieldCheck}
          loading={loading}
          accent="bg-gold-400/20 text-gold-500"
        />
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <p className="text-sm text-gray-500">
          Teacher account management is coming in the next step.
        </p>
      </div>
    </div>
  )
}