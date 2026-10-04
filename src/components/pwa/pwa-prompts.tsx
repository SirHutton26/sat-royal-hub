import { useEffect, useState } from 'react'
import { Bell, Download, Share, X } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { enablePush, isIos, isStandalone, pushSupported } from '@/lib/push'

interface InstallEvent extends Event {
  prompt(): Promise<void>
}

export default function PwaPrompts() {
  const { session } = useAuth()
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('pwa-hide') === '1')
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))
  const [msg, setMsg] = useState('')
  const standalone = isStandalone()
  const userId = session?.user.id

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  // Already allowed on this device: quietly make sure it's saved for the signed-in user
  useEffect(() => {
    if (userId && perm === 'granted' && pushSupported()) enablePush(userId)
  }, [userId, perm])

  function hide() {
    sessionStorage.setItem('pwa-hide', '1')
    setHidden(true)
  }

  if (hidden || !userId) return null

  let content: React.ReactNode = null

  if (!standalone && isIos()) {
    content = (
      <>
        <Share className="h-5 w-5 shrink-0" />
        <p className="text-sm">
          To install: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>. Open it from the home screen to
          get alerts.
        </p>
      </>
    )
  } else if (!standalone && installEvt) {
    content = (
      <>
        <Download className="h-5 w-5 shrink-0" />
        <p className="flex-1 text-sm">Install SAT ROYAL HUB on your phone.</p>
        <button
          onClick={async () => {
            await installEvt.prompt()
            setInstallEvt(null)
          }}
          className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-semibold text-royal-900"
        >
          Install
        </button>
      </>
    )
  } else if (pushSupported() && perm === 'default' && (standalone || !isIos())) {
    content = (
      <>
        <Bell className="h-5 w-5 shrink-0" />
        <p className="flex-1 text-sm">{msg || 'Get school alerts in your notification bar.'}</p>
        <button
          onClick={async () => {
            const r = await enablePush(userId)
            setPerm(Notification.permission)
            if (r !== 'ok') setMsg(r === 'denied' ? 'Notifications blocked in phone settings.' : 'Could not enable. Try again.')
          }}
          className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-semibold text-royal-900"
        >
          Enable
        </button>
      </>
    )
  }

  if (!content) return null

  return (
    <div
      className="fixed inset-x-3 z-50 flex items-center gap-3 rounded-xl bg-royal-700 p-3 text-white shadow-lg md:inset-x-auto md:right-4 md:w-96"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)' }}
    >
      {content}
      <button onClick={hide} aria-label="Dismiss" className="shrink-0 rounded p-1 hover:bg-white/10">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
