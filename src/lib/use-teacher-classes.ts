import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface ClassOpt {
  id: string
  name: string
  subjects: string[]
}

/** The classes a teacher has, and the subjects they can plan for each: their own class takes every subject of its level */
export function useTeacherClasses(profileId: string | undefined) {
  const [classOpts, setClassOpts] = useState<ClassOpt[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!profileId) return
    let alive = true
    void (async () => {
      const [own, assigned, catalog] = await Promise.all([
        supabase.from('classes').select('id, name, level_group').eq('teacher_id', profileId),
        supabase.from('subject_assignments').select('subject, class:classes(id, name, level_group)').eq('teacher_id', profileId),
        supabase.from('subjects').select('name, level_group'),
      ])
      if (!alive) return
      const subjectsOf = (catalog.data ?? []) as { name: string; level_group: string | null }[]
      const map = new Map<string, { id: string; name: string; subjects: Set<string> }>()
      for (const c of (own.data ?? []) as { id: string; name: string; level_group: string | null }[]) {
        map.set(c.id, { id: c.id, name: c.name, subjects: new Set(subjectsOf.filter((s) => s.level_group === c.level_group).map((s) => s.name)) })
      }
      for (const a of (assigned.data ?? []) as unknown as { subject: string; class: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
        const c = Array.isArray(a.class) ? a.class[0] : a.class
        if (!c) continue
        const e = map.get(c.id) ?? { id: c.id, name: c.name, subjects: new Set<string>() }
        e.subjects.add(a.subject)
        map.set(c.id, e)
      }
      setClassOpts(
        [...map.values()]
          .map((e) => ({ id: e.id, name: e.name, subjects: [...e.subjects].sort((a, b) => a.localeCompare(b)) }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      )
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [profileId])

  return { classOpts, loaded }
}
