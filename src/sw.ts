import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// Loose typing so we don't need the webworker lib alongside DOM
interface SwEvent extends Event {
  waitUntil(p: Promise<unknown>): void
}
interface PushEv extends SwEvent {
  data: { json(): { title?: string; body?: string; url?: string } } | null
}
interface ClickEv extends SwEvent {
  notification: { close(): void; data?: { url?: string } }
}
interface WinClient {
  url: string
  focus(): Promise<unknown>
  navigate?(url: string): Promise<unknown>
}
const sw = self as unknown as {
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void>; matchAll(o: object): Promise<WinClient[]>; openWindow(u: string): Promise<unknown> }
  registration: { showNotification(t: string, o: object): Promise<void> }
  addEventListener(type: string, fn: (e: never) => void): void
}

cleanupOutdatedCaches()
// must be written literally as self.__WB_MANIFEST so the build can inject the file list
precacheAndRoute((self as unknown as { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }).__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

sw.addEventListener('message', ((e: { data?: { type?: string } }) => {
  if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting()
}) as never)
// A new version waits until the app asks for it (the "Update now" button, or when the app is reopened)
sw.addEventListener('activate', ((e: SwEvent) => e.waitUntil(sw.clients.claim())) as never)

sw.addEventListener('push', ((e: PushEv) => {
  let d: { title?: string; body?: string; url?: string } = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = {}
  }
  e.waitUntil(
    sw.registration.showNotification(d.title || 'SAT ROYAL HUB', {
      body: d.body || 'You have a new alert',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url: d.url || '/teacher/alerts' },
    }),
  )
}) as never)

sw.addEventListener('notificationclick', ((e: ClickEv) => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list[0]
      if (open) {
        return open.focus().then(() => open.navigate?.(url))
      }
      return sw.clients.openWindow(url)
    }),
  )
}) as never)