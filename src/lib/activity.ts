import { supabase } from '@/lib/supabase'

interface Who {
  id: string
  name: string
  role: string
}
interface Row {
  user_id: string
  user_name: string
  user_role: string
  action: string
  entity: string
  label: string | null
  details: Record<string, unknown> | null
}

let who: Who | null = null
let buf: Row[] = []
let timer: number | undefined
let last = ''
let lastAt = 0

export const setActivityUser = (u: Who | null) => {
  who = u
}

/** Send what's waiting. Silently dropped when offline (this log is best-effort). */
export async function flushActivity() {
  window.clearTimeout(timer)
  timer = undefined
  if (!buf.length) return
  const rows = buf
  buf = []
  if (!navigator.onLine) return
  try {
    await supabase.from('activity_log').insert(rows)
  } catch {
    /* ignore */
  }
}

export function logActivity(action: 'view' | 'click' | 'print' | 'logout', entity: string, label?: string, details?: Record<string, unknown>) {
  if (!who || !navigator.onLine) return
  const sig = `${action}|${entity}|${label ?? ''}`
  const now = Date.now()
  if (sig === last && now - lastAt < 1500) return // double clicks / re-renders
  last = sig
  lastAt = now
  buf.push({ user_id: who.id, user_name: who.name, user_role: who.role, action, entity, label: label ?? null, details: details ?? null })
  if (buf.length >= 20) void flushActivity()
  else if (timer === undefined) timer = window.setTimeout(() => void flushActivity(), 4000)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushActivity()
  })
}

/** /teacher/attendance/mark -> "Teacher > Attendance > Mark" */
export function prettyPath(path: string) {
  return (
    path
      .split('/')
      .filter(Boolean)
      .map((s) => (/^[0-9a-f-]{20,}$/i.test(s) ? 'details' : s.replace(/-/g, ' ')))
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' > ') || 'Home'
  )
}
