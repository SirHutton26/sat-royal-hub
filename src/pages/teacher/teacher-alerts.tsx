import { useEffect, useMemo, useState } from 'react'
import { Megaphone, Search, BellOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

interface Alert {
  id: string
  title: string
  message: string
  created_at: string
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function TeacherAlerts() {
  const { profile, refreshProfile } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const lastSeenAt = profile?.alerts_last_seen_at

      const { data } = await supabase
        .from('alerts')
        .select('id, title, message, created_at')
        .order('created_at', { ascending: false })
      if (!active) return

      const list = data ?? []
      setAlerts(list)
      if (lastSeenAt) {
        setUnreadIds(new Set(list.filter((a) => a.created_at > lastSeenAt).map((a) => a.id)))
      }
      setLoading(false)

      if (profile) {
        await supabase.from('profiles').update({ alerts_last_seen_at: new Date().toISOString() }).eq('id', profile.id)
        await refreshProfile()
      }
    }
    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return alerts
    return alerts.filter((a) => a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q))
  }, [alerts, searchQuery])

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Alerts</h1>
      <p className="mt-1 text-sm text-gray-500">School announcements from the admin.</p>

      {alerts.length > 0 && (
        <div className="relative mt-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search alerts"
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <BellOff className="h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-400">
              {alerts.length === 0 ? 'No alerts yet.' : 'No alerts match your search.'}
            </p>
          </div>
        ) : (
          filtered.map((a) => (
            <div
              key={a.id}
              className={`flex gap-3 rounded-xl border bg-white p-4 shadow-sm transition ${
                unreadIds.has(a.id) ? 'border-royal-300' : 'border-gray-200'
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
                <Megaphone className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-royal-900">{a.title}</p>
                  {unreadIds.has(a.id) && (
                    <span className="shrink-0 rounded-full bg-royal-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      New
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{a.message}</p>
                <p className="mt-1.5 text-xs text-gray-400">{relativeTime(a.created_at)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}