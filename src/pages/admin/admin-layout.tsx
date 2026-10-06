import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  Library,
  GraduationCap,
  Users,
  CalendarClock,
  Megaphone,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Fingerprint,
  Wallet,
  UserCog,
  Database,
  History,
} from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const navItems = [
  { label: 'Dashboard', to: '/admin', icon: LayoutDashboard, end: true },
  { label: 'Class', to: '/admin/class', icon: BookOpen },
  { label: 'Subjects', to: '/admin/subjects', icon: Library },
  { label: 'Students', to: '/admin/students', icon: GraduationCap },
  { label: 'Teachers', to: '/admin/teachers', icon: Users },
  { label: 'Non-Staff', to: '/admin/non-staff', icon: UserCog },
  { label: 'Staff', to: '/admin/staff-attendance', icon: Fingerprint },
  { label: 'Exams', to: '/admin/exams', icon: CalendarClock },
  { label: 'Alerts', to: '/admin/alerts', icon: Megaphone },
  { label: 'Settings', to: '/admin/settings', icon: Settings },
  { label: 'Fees', to: '/admin/fees', icon: Wallet },
  { label: 'Data House', to: '/admin/data-house', icon: Database },
  { label: 'Activity Log', to: '/admin/activity-log', icon: History },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
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

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const initials = (profile?.full_name || profile?.email || '?')
    .trim()
    .charAt(0)
    .toUpperCase()

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
            <p className="text-xs text-royal-200">Admin</p>
          </div>
        </div>
        <SidebarContent />
        <div className="border-t border-royal-500/30 p-3">
          <SignOutButton onSignOut={signOut} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between bg-gradient-to-r from-royal-600 to-royal-700 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src={schoolLogo} alt="" className="h-8 w-8 rounded-full bg-white object-contain p-1" />
          <span className="text-sm font-bold text-white">SAT ROYAL HUB</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1 text-white transition-colors hover:bg-royal-500/40"
        >
          <Menu className="h-6 w-6" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-gradient-to-b from-royal-600 to-royal-700">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-bold text-white">SAT ROYAL HUB</span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 text-white transition-colors hover:bg-royal-500/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-royal-500/30 p-3">
              <SignOutButton onSignOut={signOut} />
            </div>
          </aside>
        </div>
      )}

      {/* Page content */}
      <div className="md:ml-60">
        <div className="hidden items-center justify-between border-b border-royal-100 bg-white px-6 py-3 md:flex">
          <p className="text-sm text-gray-500">Welcome back,</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-royal-900">
              {profile?.full_name || profile?.email}
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-royal-600 text-sm font-bold text-white">
              {initials}
            </span>
          </div>
        </div>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}