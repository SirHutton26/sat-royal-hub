import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { applyUpdate, onUpdateReady, updateReady } from '@/lib/pwa-update'

/** Tells people a new version is ready, and installs it at a safe moment. */
export default function UpdatePrompt() {
  const [ready, setReady] = useState(updateReady())

  useEffect(() => {
    const unsub = onUpdateReady(() => {
      setReady(true)
      // just opened the app and nothing typed yet: update straight away
      if (performance.now() < 8000) void applyUpdate()
    })
    // leaving the app (or locking the phone) is a safe moment to switch versions
    const onHide = () => {
      if (document.visibilityState === 'hidden' && updateReady()) void applyUpdate()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  if (!ready) return null
  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-royal-700 px-4 py-3 text-sm text-white shadow-lg" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <RefreshCw className="h-4 w-4 shrink-0" />
      <p className="flex-1">A new version of SAT Royal Hub is ready.</p>
      <button onClick={() => void applyUpdate()} className="rounded-md bg-gold-400 px-3 py-1.5 text-xs font-bold text-royal-900">
        Update now
      </button>
    </div>
  )
}
