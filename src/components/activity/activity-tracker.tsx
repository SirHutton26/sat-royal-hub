import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { logActivity, prettyPath } from '@/lib/activity'

/** Records every page a signed-in user opens, the buttons they press, and printing. */
export default function ActivityTracker() {
  const { pathname } = useLocation()

  useEffect(() => {
    logActivity('view', 'page', prettyPath(pathname), { path: pathname })
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest('button, a[download], [role="button"]')
      if (!el) return
      const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.length > 60) return
      logActivity('click', 'button', text, { path: window.location.pathname })
    }
    const onPrint = () => logActivity('print', 'page', prettyPath(window.location.pathname), { path: window.location.pathname })
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeprint', onPrint)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeprint', onPrint)
    }
  }, [])

  return null
}
