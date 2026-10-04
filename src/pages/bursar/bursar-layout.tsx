import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  HandCoins,
  Coins,
  Users,
  Receipt,
  BarChart3,
  QrCode,
  ClipboardList,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

interface NavItem {
  label: string
  short?: string // shorter label for the mobile tab bar
  to?: string
  icon: LucideIcon
  soon?: boolean
}

// Items without a route yet are shown as "Soon" and are not clickable
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', short: 'Home', to: '/bursar', icon: LayoutDashboard },
  { label: 'Record Payment', short: 'Pay', to: '/bursar/record-payment', icon: HandCoins },
  { label: 'Daily Collections', short: 'Daily', to: '/bursar/daily', icon: Coins },
  { label: 'Students', to: '/bursar/students', icon: Users },
  { label: 'Receipts', to: '/bursar/receipts', icon: Receipt },
  { label: 'Reports', to: '/bursar/reports', icon: BarChart3 },
  { label: 'Attendance', short: 'Clock In', to: '/bursar/attendance', icon: QrCode },
  { label: 'Activity Log', short: 'Log', to: '/bursar/activity', icon: ClipboardList },
  { label: 'Settings', to: '/bursar/settings', icon: Settings },
]

// Bottom tab bar on phones and small tablets (the sidebar only shows from md up)
function MobileTabs() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Main"
    >
      {NAV_ITEMS.filter((i) => i.to).map((item) => (
        <NavLink
          key={item.label}
          to={item.to!}
          end
          className={({ isActive }) =>
            `flex min-w-[4.25rem] flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-semibold transition ${
              isActive ? 'text-royal-700' : 'text-gray-400 hover:text-gray-600'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`flex h-7 w-10 items-center justify-center rounded-full transition ${isActive ? 'bg-gold-400' : ''}`}>
                <item.icon className={`h-4 w-4 ${isActive ? 'text-royal-900' : ''}`} />
              </span>
              <span className="w-full truncate text-center">{item.short ?? item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon

  if (!item.to || item.soon) {
    return (
      <div className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/50">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-400">
          Soon
        </span>
      </div>
    )
  }

  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
          isActive
            ? 'bg-gold-400 text-royal-900 shadow-md'
            : 'text-white/90 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}

export default function BursarLayout() {
  const { profile, signOut } = useAuth()
  const displayName = profile?.full_name || profile?.username || 'Bursar'

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start overflow-y-auto bg-gradient-to-b from-royal-900 via-royal-700 to-royal-600 p-4 md:flex">
        <div className="flex items-center gap-3 px-2 py-3">
          <img src={schoolLogo} alt="" className="h-11 w-11 rounded-full bg-white object-contain p-1" />
          <div>
            <p className="text-sm font-bold leading-tight text-white">SAT ROYAL HUB</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400">Bursar</p>
          </div>
        </div>
        <div className="mx-2 mt-1 h-1 w-14 rounded bg-gold-400" />

        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavEntry key={item.label} item={item} />
          ))}
        </nav>

        <button
          onClick={() => void signOut()}
          className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Gold accent strip */}
        <div className="h-1 bg-gold-400" />

        {/* Top bar */}
        <header className="flex items-center justify-between bg-white px-4 py-3 shadow-sm md:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <img src={schoolLogo} alt="" className="h-8 w-8 rounded-full object-contain" />
            <p className="text-sm font-bold text-royal-900">Bursar</p>
          </div>
          <p className="hidden text-sm font-semibold text-royal-900 md:block">Fees Office</p>

          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-semibold text-royal-900">{displayName}</p>
              <p className="text-[11px] font-medium text-gold-500">Bursar</p>
            </div>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-royal-700 text-sm font-semibold text-gold-400">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:hidden"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          <Outlet />
        </main>

        <MobileTabs />
      </div>
    </div>
  )
}