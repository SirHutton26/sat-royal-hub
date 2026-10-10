// Shared helpers: phone numbers, SMS (Arkesel) and phone notifications (web push).
import webpush from 'npm:web-push@3.6.7'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-secret',
}
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('233') && d.length === 12) return d
  if (d.startsWith('0') && d.length === 10) return '233' + d.slice(1)
  if (d.length === 9) return '233' + d
  return null
}

async function arkesel(to: string, sms: string) {
  const params = new URLSearchParams({
    action: 'send-sms',
    api_key: Deno.env.get('ARKESEL_API_KEY')!,
    to,
    from: Deno.env.get('ARKESEL_SENDER_ID') ?? 'SATROYAL',
    sms,
  })
  try {
    const res = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`)
    const out = await res.json().catch(() => ({}))
    return res.ok && out.code === 'ok'
  } catch {
    return false
  }
}

/** Same text to many numbers (50 per request) */
export async function sendSmsSame(phones: string[], text: string) {
  const failed: string[] = []
  let sent = 0
  for (let i = 0; i < phones.length; i += 50) {
    const chunk = phones.slice(i, i + 50)
    if (await arkesel(chunk.join(','), text)) sent += chunk.length
    else failed.push(...chunk)
  }
  return { sent, failed }
}

/** A different text for each number */
export async function sendSmsEach(items: { phone: string; text: string }[]) {
  const failed: string[] = []
  let sent = 0
  const queue = [...items]
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        if (await arkesel(it.phone, it.text)) sent++
        else failed.push(it.phone)
      }
    }),
  )
  return { sent, failed }
}

/** Phone notification to the devices of the given users; dead subscriptions are removed */
// deno-lint-ignore no-explicit-any
export async function pushToUsers(admin: any, userIds: string[], payload: { title: string; body: string; url: string }) {
  if (!userIds.length) return 0
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds)
  const body = JSON.stringify(payload)
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    // deno-lint-ignore no-explicit-any
    (subs ?? []).map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(s.id)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  return sent
}
