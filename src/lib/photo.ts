import { supabase } from '@/lib/supabase'

const BUCKET = 'student-photos'
const TTL = 3600 // links last one hour
const cache = new Map<string, { url: string; exp: number }>()
const waiting = new Map<string, Array<(u: string | null) => void>>()
let timer: number | undefined

/** photo_url may hold an old public link or a plain storage path; always return the storage path. */
export function photoPath(value: string | null | undefined): string | null {
  if (!value || value.startsWith('blob:') || value.startsWith('data:')) return null
  if (value.startsWith('http')) {
    const m = value.match(/student-photos\/([^?]+)/)
    return m ? decodeURIComponent(m[1]) : null
  }
  return value
}

export const forgetPhoto = (value: string | null | undefined) => {
  const p = photoPath(value)
  if (p) cache.delete(p)
}

async function flush() {
  timer = undefined
  const batch = [...waiting.entries()]
  waiting.clear()
  if (!batch.length) return
  const paths = batch.map(([p]) => p)
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL)
  const byPath = new Map<string, string>()
  for (const row of data ?? []) if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl)
  for (const [p, resolvers] of batch) {
    const url = byPath.get(p) ?? null
    if (url) cache.set(p, { url, exp: Date.now() + (TTL - 120) * 1000 })
    resolvers.forEach((r) => r(url))
  }
}

/** Short-lived link for a stored photo. Requests made in the same moment are sent together. */
export function signedPhotoUrl(value: string | null | undefined): Promise<string | null> {
  const path = photoPath(value)
  if (!path) return Promise.resolve(value ?? null) // blob: / data: previews pass straight through
  const hit = cache.get(path)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url)
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve])
    if (timer === undefined) timer = window.setTimeout(() => void flush(), 25)
  })
}
