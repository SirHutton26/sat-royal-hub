import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

interface Alert {
  id: string
  title: string
  message: string
  created_at: string
}

export default function TeacherAlerts() {
  const { profile, refreshProfile } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase
        .from('alerts')
        .select('id, title, message, created_at')
        .order('created_at', { ascending: false })
      if (!active) return
      setAlerts(data ?? [])
      setLoading(false)

      if (profile) {
        await supabase
          .from('profiles')
          .update({ alerts_last_seen_at: new Date().toISOString() })
          .eq('id', profile.id)
        await refreshProfile()
      }
    }
    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Alerts</h1>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-gray-400">No alerts yet.</p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="flex gap-3 rounded-xl bg-white p-4 shadow-sm">
              <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" />
              <div>
                <p className="text-sm font-semibold text-royal-900">{a.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">{a.message}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}