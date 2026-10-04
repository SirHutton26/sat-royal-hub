import { db, getOfflineUser, notifyOutbox } from './offline-db'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
// Only these tables accept writes while offline (they are safe to replay later)
const QUEUE_TABLES = new Set(['attendance', 'score_bank_entries', 'score_bank_scores', 'exam_scores'])
const SKIP_HEADERS = new Set(['authorization', 'apikey', 'x-client-info'])
const NON_FILTERS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function withTimeout(input: RequestInfo | URL, init: RequestInit | undefined, ms: number) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const outer = init?.signal
  if (outer) {
    if (outer.aborted) ctl.abort()
    else outer.addEventListener('abort', () => ctl.abort(), { once: true })
  }
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer))
}

const fromCache = (c: { status: number; body: string; ctype: string; range: string | null }) =>
  new Response(c.body || null, {
    status: c.status,
    headers: { 'content-type': c.ctype, ...(c.range ? { 'content-range': c.range } : {}) },
  })

type Row = Record<string, unknown>

function eqFilters(u: URL) {
  const f: Array<[string, string]> = []
  let other = false
  u.searchParams.forEach((v, k) => {
    if (NON_FILTERS.has(k)) return
    if (v.startsWith('eq.')) f.push([k, v.slice(3)])
    else other = true
  })
  return { f, other }
}
const matches = (row: Row, f: Array<[string, string]>) => f.every(([k, v]) => String(row[k]) === v)

/** Mirror an offline write into cached lists so the screens show it straight away */
async function patchCache(uid: string, table: string, method: string, url: string, body: unknown): Promise<Row[]> {
  const w = new URL(url)
  const { f, other } = eqFilters(w)
  const matched: Row[] = []
  const entries = await db.cache
    .where('userId')
    .equals(uid)
    .filter((c) => c.key.includes('|GET|') && !c.key.includes('vnd.pgrst.object') && new URL(c.url).pathname.endsWith('/rest/v1/' + table))
    .toArray()
  const changed = []
  for (const c of entries) {
    let arr: Row[]
    try {
      arr = JSON.parse(c.body)
      if (!Array.isArray(arr)) continue
    } catch {
      continue
    }
    if (method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]) as Row[]
      const conflict = (w.searchParams.get('on_conflict') ?? 'id').split(',')
      const cf = eqFilters(new URL(c.url)).f
      for (const r of rows) {
        const i = arr.findIndex((o) => conflict.every((k) => r[k] !== undefined && String(o[k]) === String(r[k])))
        if (i >= 0) arr[i] = { ...arr[i], ...r }
        else if (matches(r, cf)) arr.push(r)
        if (!matched.includes(r)) matched.push(r)
      }
    } else if (!other && method === 'PATCH') {
      arr = arr.map((o) => (matches(o, f) ? (matched.push(o), { ...o, ...(body as Row) }) : o))
    } else if (!other && method === 'DELETE') {
      arr = arr.filter((o) => (matches(o, f) ? (matched.push(o), false) : true))
    } else continue
    changed.push({ ...c, body: JSON.stringify(arr) })
  }
  if (changed.length) await db.cache.bulkPut(changed)
  return matched
}

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.includes('/rest/v1/')) return fetch(input, init)

  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  const uid = getOfflineUser()
  const bearer = (headers.get('authorization') ?? '').replace('Bearer ', '')
  const authed = !!bearer && bearer !== ANON // never cache anonymous (RLS-empty) responses
  const path = new URL(url).pathname.replace(/^.*\/rest\/v1\//, '')
  const isRpc = path.startsWith('rpc/')

  /* ---------- reads ---------- */
  if (method === 'GET' || method === 'HEAD' || isRpc) {
    const key = [uid, method, url, headers.get('accept') ?? '', headers.get('prefer') ?? '', isRpc ? String(init?.body ?? '') : ''].join('|')
    const cached = uid ? await db.cache.get(key) : undefined
    if (!navigator.onLine && cached) return fromCache(cached)
    try {
      const res = await (cached ? withTimeout(input, init, 10000) : fetch(input, init))
      if (res.ok && uid && authed) {
        const body = method === 'HEAD' ? '' : await res.clone().text()
        void db.cache.put({
          key,
          userId: uid,
          url,
          status: res.status,
          body,
          ctype: res.headers.get('content-type') ?? 'application/json',
          range: res.headers.get('content-range'),
          ts: Date.now(),
        })
      }
      return res
    } catch (e) {
      if (cached) return fromCache(cached)
      throw e
    }
  }

  /* ---------- writes ---------- */
  const table = path.split('?')[0].split('/')[0]
  if (!QUEUE_TABLES.has(table) || !uid || !authed) return fetch(input, init)

  // Give new score-bank entries an id up front so replays are safe and follow-up rows can point at it
  let bodyText = typeof init?.body === 'string' ? init.body : null
  if (table === 'score_bank_entries' && method === 'POST' && bodyText) {
    const parsed = JSON.parse(bodyText)
    const withId = (r: Row) => (r.id ? r : { ...r, id: crypto.randomUUID() })
    bodyText = JSON.stringify(Array.isArray(parsed) ? parsed.map(withId) : withId(parsed))
    init = { ...init, body: bodyText }
  }

  if (navigator.onLine) {
    try {
      return await withTimeout(input, init, 30000)
    } catch (e) {
      if (!(e instanceof TypeError) && (e as Error).name !== 'AbortError') throw e
    }
  }

  // Offline: queue it and answer as if it worked
  const saved: Record<string, string> = {}
  headers.forEach((v, k) => {
    if (!SKIP_HEADERS.has(k)) saved[k] = v
  })
  await db.outbox.add({ userId: uid, method, url, headers: saved, body: bodyText, table, ts: Date.now() })
  const parsedBody = bodyText ? JSON.parse(bodyText) : null
  const matched = await patchCache(uid, table, method, url, parsedBody)
  notifyOutbox()

  const wantsRep = (headers.get('prefer') ?? '').includes('return=representation')
  const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object+json')
  let out: unknown = null
  if (wantsRep) {
    const rows = method === 'POST' ? (Array.isArray(parsedBody) ? parsedBody : [parsedBody]) : matched
    out = single ? rows[0] ?? null : rows
  }
  return new Response(out === null ? null : JSON.stringify(out), {
    status: out === null ? (method === 'POST' ? 201 : 204) : method === 'POST' ? 201 : 200,
    headers: out === null ? {} : { 'content-type': 'application/json' },
  })
}
