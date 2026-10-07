import { useEffect, useState, type ReactNode } from 'react'
import { signedPhotoUrl } from '@/lib/photo'

/** Shows a student's photo through a short-lived link. Shows `fallback` (e.g. initials) if it can't load. */
export default function StudentPhotoImg({ url, className, fallback }: { url: string; className: string; fallback: ReactNode }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setSrc(undefined)
    signedPhotoUrl(url).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [url])

  if (src === undefined) return <span className={`${className} animate-pulse bg-gray-200`} />
  if (!src) return <>{fallback}</>
  return <img src={src} alt="" className={className} onError={() => setSrc(null)} />
}
