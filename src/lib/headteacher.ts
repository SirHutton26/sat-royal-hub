import { supabase } from '@/lib/supabase'
import { STAFF_WINDOWS, accraMinutesNow, localISO } from '@/lib/attendance'

export const STAFF_ROLES = ['teacher', 'bursar', 'headteacher', 'storekeeper']
export const ROLE_LABEL: Record<string, string> = { teacher: 'Teacher', bursar: 'Bursar', headteacher: 'Headteacher', storekeeper: 'Store-keeper' }

export interface Staff {
  id: string
  full_name: string | null
  email: string | null
  role: string
}
export interface StaffRec {
  teacher_id: string
  clock_in_at: string | null
  clock_out_at: string | null
  status: string | null
}
export interface Student {
  id: string
  full_name: string
  class_id: string
  gender: string | null
}
export interface ClassRow {
  id: string
  name: string
  teacher_id: string | null
}
export interface Att {
  student_id: string
  class_id: string
  status: string
}
export interface Day {
  staff: Staff[]
  staffRecs: StaffRec[]
  classes: ClassRow[]
  students: Student[]
  att: Att[]
}

export const isMale = (g: string | null) => /^m/i.test(g ?? '')
export const isFemale = (g: string | null) => /^f/i.test(g ?? '')

/** The API returns at most 1000 rows per request, so read in pages */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = []
  for (let o = 0; ; o += 1000) {
    const { data } = await build(o, o + 999)
    out.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function loadDay(date: string): Promise<Day> {
  const [p, s, c, st, a] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role').in('role', STAFF_ROLES).eq('is_active', true).order('full_name'),
    supabase.from('staff_attendance').select('teacher_id, clock_in_at, clock_out_at, status').eq('date', date),
    supabase.from('classes').select('id, name, teacher_id').order('name'),
    fetchAll<Student>((x, y) => supabase.from('students').select('id, full_name, class_id, gender').eq('is_active', true).order('full_name').range(x, y)),
    fetchAll<Att>((x, y) => supabase.from('attendance').select('student_id, class_id, status').eq('date', date).range(x, y)),
  ])
  return { staff: (p.data ?? []) as Staff[], staffRecs: (s.data ?? []) as StaffRec[], classes: (c.data ?? []) as ClassRow[], students: st, att: a }
}

/** After 12:00 noon (Ghana) anyone without a check-in is Absent; earlier today they simply haven't come yet */
export const staffAbsentNow = (date: string) => date !== localISO() || accraMinutesNow() > STAFF_WINDOWS.veryLateEnd

export function staffSummary(d: Day, date: string) {
  const recOf = new Map(d.staffRecs.map((r) => [r.teacher_id, r]))
  const absentNow = staffAbsentNow(date)
  const present = d.staffRecs.filter((r) => r.status !== 'Late' && r.status !== 'Very Late').length
  const late = d.staffRecs.filter((r) => r.status === 'Late').length
  const veryLate = d.staffRecs.filter((r) => r.status === 'Very Late').length
  const absent = absentNow ? d.staff.filter((s) => !recOf.has(s.id)).length : 0
  return { recOf, absentNow, present, late, veryLate, absent, total: d.staff.length }
}

export function classRows(d: Day) {
  const statusOf = new Map(d.att.map((a) => [a.student_id, a.status.toLowerCase()]))
  return d.classes.map((c) => {
    const roll = d.students.filter((s) => s.class_id === c.id)
    const present = roll.filter((s) => statusOf.get(s.id) === 'present')
    const late = roll.filter((s) => statusOf.get(s.id) === 'late')
    const absent = roll.filter((s) => statusOf.get(s.id) === 'absent')
    const attending = [...present, ...late]
    return {
      c,
      roll: roll.length,
      present: present.length,
      late: late.length,
      absent: absent.length,
      notMarked: roll.length - attending.length - absent.length,
      boys: attending.filter((s) => isMale(s.gender)).length,
      girls: attending.filter((s) => isFemale(s.gender)).length,
      absentNames: absent.map((s) => s.full_name),
      lateNames: late.map((s) => s.full_name),
    }
  })
}

export const pctPresent = (r: { roll: number; present: number; late: number }) => (r.roll ? Math.round(((r.present + r.late) / r.roll) * 100) : 0)
