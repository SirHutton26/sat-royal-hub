import { supabase } from '@/lib/supabase'
import { db, notifyOutbox } from '@/lib/offline-db'
import { localISO } from '@/lib/attendance'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
let flushing = false

/** Send queued offline writes, oldest first. Stops on connection/auth trouble, parks hard rejections as failed. */
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) return
    const rows = await db.outbox.where('userId').equals(session.user.id).filter((r) => !r.failed).sortBy('id')
    for (const r of rows) {
      let res: Response
      try {
        res = await fetch(r.url, {
          method: r.method,
          headers: { ...r.headers, apikey: ANON, Authorization: `Bearer ${session.access_token}` },
          body: r.body,
        })
      } catch {
        break
      }
      if (res.ok || res.status === 409) await db.outbox.delete(r.id!)
      else if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) break
      else await db.outbox.update(r.id!, { failed: 1, error: (await res.text()).slice(0, 200) })
    }
  } finally {
    flushing = false
    notifyOutbox()
  }
}

export async function outboxCounts(userId: string) {
  const all = await db.outbox.where('userId').equals(userId).toArray()
  return { pending: all.filter((r) => !r.failed).length, failed: all.filter((r) => r.failed).length }
}

export async function clearFailed(userId: string) {
  await db.outbox.where('userId').equals(userId).filter((r) => !!r.failed).delete()
  notifyOutbox()
}

/* Pre-load what a teacher needs offline. Queries mirror the pages exactly so the cache keys match. */
const STUDENT_COLUMNS =
  'id, full_name, admission_number, gender, date_of_birth, guardian_name, guardian_phone, photo_url, is_active'

function monday(d = new Date()) {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export async function warmTeacherCache(userId: string, lastSeen: string) {
  const stamp = `sat-hub-warm-${userId}`
  if (!navigator.onLine || Date.now() - Number(localStorage.getItem(stamp) ?? 0) < 6 * 3600 * 1000) return
  const q = supabase
  const [{ data: cls }, { data: assigns }] = await Promise.all([
    q.from('classes').select('id, name, level_group').eq('teacher_id', userId).maybeSingle(),
    q.from('subject_assignments').select('subject, class_id, class:classes(name, level_group)').eq('teacher_id', userId),
  ])
  void q.from('subject_assignments').select('subject, class_id, class:classes(name)').eq('teacher_id', userId)
  void q.from('classes').select('id, name').eq('teacher_id', userId).maybeSingle()
  void q.from('school_settings').select('current_academic_year, current_term').limit(1).maybeSingle()
  void q.from('alerts').select('id, title, message, created_at').order('created_at', { ascending: false })
  void q.from('alerts').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen)

  const classIds = new Set<string>()
  if (cls) classIds.add(cls.id)
  for (const a of assigns ?? []) classIds.add(a.class_id)

  const today = localISO()
  const mon = monday()
  const fri = new Date(mon)
  fri.setDate(fri.getDate() + 4)

  const jobs: PromiseLike<unknown>[] = []
  for (const id of classIds) {
    jobs.push(q.from('students').select('id, full_name, admission_number').eq('class_id', id).eq('is_active', true).order('full_name'))
    jobs.push(q.from('students').select('id, gender').eq('class_id', id).eq('is_active', true))
  }
  if (cls) {
    jobs.push(q.from('students').select(STUDENT_COLUMNS).eq('class_id', cls.id).eq('is_active', true).order('full_name'))
    jobs.push(q.from('students').select('id', { count: 'exact', head: true }).eq('class_id', cls.id).eq('is_active', true))
    jobs.push(q.from('attendance').select('student_id, status').eq('class_id', cls.id).eq('date', today))
    jobs.push(q.from('attendance').select('id', { count: 'exact', head: true }).eq('class_id', cls.id).eq('date', today))
    jobs.push(q.from('attendance').select('student_id, date, status').eq('class_id', cls.id).gte('date', localISO(mon)).lte('date', localISO(fri)))
    jobs.push(q.from('subjects').select('name').eq('level_group', cls.level_group).order('name'))
  }
  jobs.push(q.from('score_bank_entries').select('id, class_id, title, subject, term, total_score, created_at, class:classes(name)').eq('teacher_id', userId).order('created_at', { ascending: false }))
  await Promise.allSettled(jobs)
  localStorage.setItem(stamp, String(Date.now()))
}
