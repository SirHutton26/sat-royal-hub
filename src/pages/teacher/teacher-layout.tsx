import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  BookOpen,
  QrCode,
  LogOut,
  ChevronRight,
  Bell,
} from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import schoolLogo from '@/assets/school-logo.png'

const navItems = [
  { label: 'Dashboard', to: '/teacher', icon: LayoutDashboard, end: true },
  { label: 'My Class', to: '/teacher/class', icon: Users },
  { label: 'Attendance', to: '/teacher/attendance', icon: ClipboardCheck },
  { label: 'Grades', to: '/teacher/grades', icon: BookOpen },
  { label: 'Clock In', to: '/teacher/clock-in', icon: QrCode },
]

function SidebarContent() {
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-gold-400 text-royal-900 shadow-sm'
                : 'text-royal-50 hover:translate-x-0.5 hover:bg-royal-700/70'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                className={`h-4 w-4 transition-transform duration-150 ${
                  !isActive && 'group-hover:scale-110'
                }`}
              />
              {item.label}
              {isActive && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
              isActive ? 'text-royal-600' : 'text-gray-400 hover:text-royal-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={`h-5 w-5 ${isActive && 'scale-110'} transition-transform`} />
              <span className={`text-[10px] font-medium ${isActive && 'font-semibold'}`}>
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      onClick={onSignOut}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-royal-50 transition-colors hover:bg-red-500/20 hover:text-red-100"
    >
      <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      Sign out
    </button>
  )
}

function Avatar({ url, initials, size }: { url: string | null; initials: string; size: string }) {
  if (url) {
    return <img src={url} alt="" className={`${size} rounded-full object-cover`} />
  }
  return (
    <span
      className={`flex ${size} items-center justify-center rounded-full bg-royal-600 text-sm font-bold text-white`}
    >
      {initials}
    </span>
  )
}

function AlertBell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Alerts" className="relative rounded-full p-1.5 hover:bg-royal-500/20">
      <Bell className="h-5 w-5 text-white" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}

export default function TeacherLayout() {
  const { profile, signOut} = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const initials = (profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase()

  useEffect(() => {
    let active = true
    async function loadUnread() {
      if (!profile) return
      const { count } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', profile.alerts_last_seen_at)
      if (active) setUnreadCount(count ?? 0)
    }
    loadUnread()
    return () => {
      active = false
    }
  }, [profile?.alerts_last_seen_at])

  async function openAlerts() {
    setMenuOpen(false)
    navigate('/teacher/alerts')
  }

  return (
    <div className="min-h-screen bg-royal-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-gradient-to-b from-royal-600 to-royal-700 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <img
            src={schoolLogo}
            alt=""
            className="h-9 w-9 rounded-full bg-white object-contain p-1 ring-2 ring-gold-400/40"
          />
          <div>
            <p className="text-sm font-bold leading-tight text-white">SAT ROYAL HUB</p>
            <p className="text-xs text-royal-200">Teacher</p>
          </div>
        </div>
        <SidebarContent />
        <div className="border-t border-royal-500/30 p-3">
          <SignOutButton onSignOut={signOut} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="relative flex items-center justify-between bg-gradient-to-r from-royal-600 to-royal-700 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src={schoolLogo} alt="" className="h-8 w-8 rounded-full bg-white object-contain p-1" />
          <span className="text-sm font-bold text-white">SAT ROYAL HUB</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertBell count={unreadCount} onClick={openAlerts} />
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu">
            <Avatar url={profile?.avatar_url ?? null} initials={initials} size="h-8 w-8" />
          </button>
        </div>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-4 top-14 z-50 w-48 rounded-xl bg-white p-2 shadow-lg">
              <p className="truncate px-2 py-1.5 text-xs text-gray-500">
                {profile?.full_name || profile?.email}
              </p>
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        )}
      </header>

      {/* Page content */}
      <div className="md:ml-60">
        <div className="hidden items-center justify-between border-b border-royal-100 bg-white px-6 py-3 md:flex">
          <p className="text-sm text-gray-500">Welcome back,</p>
          <div className="flex items-center gap-3">
            <button onClick={openAlerts} className="relative rounded-full p-1.5 hover:bg-royal-50" aria-label="Alerts">
              <Bell className="h-5 w-5 text-royal-600" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <p className="text-sm font-semibold text-royal-900">
              {profile?.full_name || profile?.email}
            </p>
            <Avatar url={profile?.avatar_url ?? null} initials={initials} size="h-8 w-8" />
          </div>
        </div>
        <main className="p-4 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}