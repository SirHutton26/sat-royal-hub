// Shared rules for staff, non-teaching staff and student attendance.
// Attendance is only taken on school days: Monday to Friday.

export const CAMPUS_QR_SECRET = 'SAT-ROYAL-CAMPUS-CHECKIN-2026'

export const WEEKEND_MESSAGE = 'Attendance is only taken on school days, Monday to Friday.'

// Staff clock-in windows, in minutes from midnight
export const STAFF_WINDOWS = {
  checkInStart: 6 * 60, // 6:00 AM
  presentEnd: 7 * 60 + 15, // on time until 7:15 AM
  lateEnd: 9 * 60 + 15, // Late until 9:15 AM, absent after
  signOutStart: 15 * 60, // 3:00 PM
  signOutEnd: 18 * 60, // 6:00 PM
}

/** YYYY-MM-DD in the device's local time (toISOString would give UTC) */
export function localISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD as a local date (new Date('2026-10-03') would be UTC midnight) */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** True for Monday to Friday */
export function isWeekday(date: Date | string = new Date()): boolean {
  const d = typeof date === 'string' ? parseISODate(date) : date
  const day = d.getDay()
  return day >= 1 && day <= 5
}

/** The given day if it is a weekday, otherwise the Friday before it */
export function lastWeekday(date: Date | string = new Date()): string {
  const d = new Date(typeof date === 'string' ? parseISODate(date) : date)
  while (!isWeekday(d)) d.setDate(d.getDate() - 1)
  return localISO(d)
}