import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isWeekday, localISO } from '@/lib/attendance'

export interface TermDate {
  id?: string
  academic_year: string
  term: string
  start_date: string
  end_date: string
}
export interface Holiday {
  id: string
  name: string
  start_date: string
  end_date: string
}

export const isHoliday = (iso: string, holidays: Holiday[]) => holidays.some((h) => iso >= h.start_date && iso <= h.end_date)
export const holidayName = (iso: string, holidays: Holiday[]) => holidays.find((h) => iso >= h.start_date && iso <= h.end_date)?.name ?? ''

/** A school day is Monday to Friday and not inside a holiday */
export const isSchoolDay = (iso: string, holidays: Holiday[]) => isWeekday(iso) && !isHoliday(iso, holidays)

export function schoolDaysBetween(from: string, to: string, holidays: Holiday[]) {
  let n = 0
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    if (isSchoolDay(localISO(d), holidays)) n++
    d.setDate(d.getDate() + 1)
  }
  return n
}

/** The term that contains the date, otherwise the most recent one that has already started */
export function termOn(terms: TermDate[], iso: string): TermDate | null {
  const inside = terms.find((t) => iso >= t.start_date && iso <= t.end_date)
  if (inside) return inside
  const started = terms.filter((t) => t.start_date <= iso).sort((a, b) => b.start_date.localeCompare(a.start_date))
  return started[0] ?? null
}

/** Term dates and holidays set by the admin. `term` is null until the admin has entered them. */
export function useTermDates() {
  const [terms, setTerms] = useState<TermDate[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [t, h] = await Promise.all([
      supabase.from('term_dates').select('id, academic_year, term, start_date, end_date').order('start_date'),
      supabase.from('school_holidays').select('id, name, start_date, end_date').order('start_date'),
    ])
    setTerms((t.data ?? []) as TermDate[])
    setHolidays((h.data ?? []) as Holiday[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const term = termOn(terms, localISO())
  return { terms, holidays, term, loading, reload }
}