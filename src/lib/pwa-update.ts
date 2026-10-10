let ready = false
let apply: (() => Promise<void>) | null = null
const listeners = new Set<() => void>()

export const setUpdater = (fn: () => Promise<void>) => {
  apply = fn
}
export function markUpdateReady() {
  ready = true
  listeners.forEach((l) => l())
}
export const updateReady = () => ready
export const onUpdateReady = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const applyUpdate = () => apply?.()
