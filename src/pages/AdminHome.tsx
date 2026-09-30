import { useAuth } from '@/features/auth/AuthProvider'

export default function AdminHome() {
  const { profile, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-royal-50">
      <header className="flex items-center justify-between bg-royal-600 px-4 py-3 text-white">
        <span className="font-bold tracking-wide">SAT ROYAL HUB · Admin</span>
        <button onClick={signOut} className="rounded bg-gold-400 px-3 py-1 text-sm font-semibold text-royal-900">
          Sign out
        </button>
      </header>
      <main className="p-4">
        <h1 className="text-xl font-semibold text-royal-900">
          Welcome, {profile?.full_name || profile?.email}
        </h1>
        <p className="mt-2 text-gray-600">Admin dashboard coming soon.</p>
      </main>
    </div>
  )
}