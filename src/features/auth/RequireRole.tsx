import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, type Role } from './AuthProvider'

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-royal-600 text-white">
      <p className="text-lg font-semibold tracking-wide">SAT ROYAL HUB</p>
    </div>
  )
}

const ONBOARDING_PATH = '/teacher/onboarding'

export function RequireRole({ role }: { role: Role }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Splash />
  if (!session || !profile || !profile.is_active) return <Navigate to="/login" replace />
  if (profile.role !== role) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/teacher'} replace />
  }

  const needsOnboarding = profile.role === 'teacher' && !profile.onboarding_completed
  if (needsOnboarding && location.pathname !== ONBOARDING_PATH) {
    return <Navigate to={ONBOARDING_PATH} replace />
  }
  if (!needsOnboarding && location.pathname === ONBOARDING_PATH) {
    return <Navigate to="/teacher" replace />
  }

  return <Outlet />
}