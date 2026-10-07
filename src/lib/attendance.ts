// Shared rules for staff, non-teaching staff and student attendance.
// Attendance is only taken on school days: Monday to Friday.

export const WEEKEND_MESSAGE = 'Attendance is only taken on school days, Monday to Friday.'

// Staff clock-in rules, in minutes from midnight (Ghana time)
export const STAFF_WINDOWS = {
  checkInStart: 6 * 60, // 6:00 AM
  presentEnd: 7 * 60 + 15, // 6:00 - 7:15  Present (green)
  lateEnd: 9 * 60 + 15, // 7:16 - 9:15  Present but late (orange)
  veryLateEnd: 12 * 60, // 9:16 - 12:00 Present but extremely late (red); after 12:00 = Absent
  signOutStart: 15 * 60, // 3:00 PM
  signOutEnd: 18 * 60, // 6:00 PM
}

/** What the database stores -> what people read */
export function staffStatusLabel(status: string | null | undefined) {
  if (status === 'Late') return 'Present but late'
  if (status === 'Very Late') return 'Present but extremely late'
  return status ?? ''
}

/** Colours for a status pill */
export function staffStatusClass(status: string | null | undefined) {
  if (status === 'Late') return 'bg-orange-50 text-orange-700'
  if (status === 'Very Late') return 'bg-red-50 text-red-700'
  return 'bg-green-50 text-green-700'
}

/** Minutes since midnight right now in Ghana (Africa/Accra), whatever the device's time zone */
export function accraMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const h = Number(parts.find((x) => x.type === 'hour')?.value ?? 0) % 24
  return h * 60 + Number(parts.find((x) => x.type === 'minute')?.value ?? 0)
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