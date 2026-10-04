import { useCallback, useEffect, useState } from 'react'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { OUTBOX_EVENT, pruneCache } from '@/lib/offline-db'
import { clearFailed, flushOutbox, outboxCounts, warmBalances, warmTeacherCache } from '@/lib/offline-sync'

export default function SyncManager() {
  const { session, profile, offline } = useAuth()
  const userId = session?.user.id
  const [online, setOnline] = useState(navigator.onLine)
  const [counts, setCounts] = useState({ pending: 0, failed: 0 })

  const refresh = useCallback(async () => {
    if (userId) setCounts(await outboxCounts(userId))
  }, [userId])

  useEffect(() => {
    const on = () => {
      setOnline(true)
      void flushOutbox()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener(OUTBOX_EVENT, refresh)
    void pruneCache()
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener(OUTBOX_EVENT, refresh)
    }
  }, [refresh])

  // On sign-in / app open: send anything waiting, then pre-load teacher data; retry every minute while pending
  useEffect(() => {
    if (!userId || offline) return
    void refresh()
    void flushOutbox().then(() => {
      if (profile?.role === 'teacher') void warmTeacherCache(userId, profile.alerts_last_seen_at)
      if (profile?.role === 'bursar' || profile?.role === 'admin') void warmBalances()
    })
    const t = setInterval(() => void flushOutbox(), 60000)
    return () => clearInterval(t)
  }, [userId, offline, profile?.role, profile?.alerts_last_seen_at, refresh])

  if (!userId) return null
  if (online && !offline && counts.pending === 0 && counts.failed === 0) return null

  const failedOnly = online && counts.pending === 0 && counts.failed > 0
  return (
    <div
      className={`fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-white ${
        failedOnly ? 'bg-red-600' : online ? 'bg-royal-600' : 'bg-gray-800'
      }`}
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.375rem)' }}
    >
      {failedOnly ? <TriangleAlert className="h-3.5 w-3.5" /> : online ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudOff className="h-3.5 w-3.5" />}
      <span>
        {!online || offline
          ? `Offline${counts.pending ? ` - ${counts.pending} change(s) will sync when you're back online` : ' - showing saved data'}`
          : counts.pending
            ? `Syncing ${counts.pending} change(s)...`
            : `${counts.failed} change(s) were rejected by the server and not saved`}
      </span>
      {failedOnly && (
        <button onClick={() => userId && clearFailed(userId)} className="underline">
          Dismiss
        </button>
      )}
    </div>
  )
}
