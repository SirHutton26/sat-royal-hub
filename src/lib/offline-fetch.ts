import { db, getOfflineUser, notifyOutbox } from './offline-db'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
// Only these tables accept writes while offline (they are safe to replay later)
const QUEUE_TABLES = new Set([
  'attendance',
  'score_bank_entries',
  'score_bank_scores',
  'exam_scores',
  'staff_attendance',
  'daily_collections',
  'daily_feeding',
  'weekly_class_fee_remittances',
  'fee_payments',
])
// Everything else (payments, creating/deleting records, settings) needs a connection
const OFFLINE_REPLY = () =>
  new Response(JSON.stringify({ code: 'OFFLINE', message: 'You are offline. This action needs an internet connection.' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  })
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

export const stripEq = (url: string) => {
  const u = new URL(url)
  for (const [k, v] of [...u.searchParams.entries()]) if (v.startsWith('eq.')) u.searchParams.delete(k)
  return u.href
}

/** Offline and no exact match: answer from a cached full-table copy by applying the eq filters locally */
async function fromSuperset(uid: string, method: string, url: string, headers: Headers) {
  if (method !== 'GET' || (headers.get('accept') ?? '').includes('vnd.pgrst.object')) return undefined
  const base = stripEq(url)
  if (base === url) return undefined
  const row = await db.cache.get([uid, method, base, headers.get('accept') ?? '', headers.get('prefer') ?? '', ''].join('|'))
  if (!row) return undefined
  try {
    const f = eqFilters(new URL(url)).f
    const arr = (JSON.parse(row.body) as Row[]).filter((o) => matches(o, f))
    return { ...row, body: JSON.stringify(arr), range: null as string | null }
  } catch {
    return undefined
  }
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

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
    if (!navigator.onLine && !cached && uid) {
      const sup = await fromSuperset(uid, method, url, headers)
      if (sup) return fromCache(sup)
    }
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
      const sup = uid && e instanceof TypeError ? await fromSuperset(uid, method, url, headers) : undefined
      if (sup) return fromCache(sup)
      throw e
    }
  }

  /* ---------- writes ---------- */
  const table = path.split('?')[0].split('/')[0]
  if (!QUEUE_TABLES.has(table) || !uid || !authed) return navigator.onLine ? fetch(input, init) : OFFLINE_REPLY()

  // Give new score-bank entries an id up front so replays are safe and follow-up rows can point at it
  let bodyText = typeof init?.body === 'string' ? init.body : null
  if (table === 'score_bank_entries' && method === 'POST' && bodyText) {
    const parsed = JSON.parse(bodyText)
    const withId = (r: Row) => (r.id ? r : { ...r, id: crypto.randomUUID() })
    bodyText = JSON.stringify(Array.isArray(parsed) ? parsed.map(withId) : withId(parsed))
    init = { ...init, body: bodyText }
  }

  // Payments: a unique client_ref makes a replay safe (the server rejects a second copy), and paid_at keeps the real time
  let tempNo: string | undefined
  let payRow: Row | undefined
  if (table === 'fee_payments' && method === 'POST' && bodyText) {
    const parsed = JSON.parse(bodyText)
    const one = (Array.isArray(parsed) ? parsed[0] : parsed) as Row
    payRow = { ...one, client_ref: one.client_ref ?? crypto.randomUUID(), paid_at: one.paid_at ?? new Date().toISOString() }
    tempNo = 'OFF-' + String(payRow.client_ref).replace(/-/g, '').slice(0, 6).toUpperCase()
    bodyText = JSON.stringify(Array.isArray(parsed) ? [payRow] : payRow)
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
  await db.outbox.add({ userId: uid, method, url, headers: saved, body: bodyText, table, ts: Date.now(), tempNo })
  const parsedBody = bodyText ? JSON.parse(bodyText) : null
  const matched = await patchCache(uid, table, method, url, parsedBody)
  if (payRow) await patchBalances(uid, payRow)
  notifyOutbox()

  const wantsRep = (headers.get('prefer') ?? '').includes('return=representation')
  const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object+json')
  let out: unknown = null
  if (wantsRep) {
    let rows = method === 'POST' ? (Array.isArray(parsedBody) ? parsedBody : [parsedBody]) : matched
    if (tempNo) rows = rows.map((r: Row) => ({ ...r, receipt_no: tempNo }))
    out = single ? rows[0] ?? null : rows
  }
  return new Response(out === null ? null : JSON.stringify(out), {
    status: out === null ? (method === 'POST' ? 201 : 204) : method === 'POST' ? 201 : 200,
    headers: out === null ? {} : { 'content-type': 'application/json' },
  })
}

/* Track in-flight data requests so "Download for offline" knows when a page has finished loading */
let inflight = 0
let lastEnd = Date.now()
/** An offline payment lowers the cached balance for that student and fee item */
async function patchBalances(uid: string, pay: Row) {
  const amt = Number(pay.amount)
  const entries = await db.cache
    .where('userId')
    .equals(uid)
    .filter((c) => c.key.includes('|GET|') && !c.key.includes('vnd.pgrst.object') && new URL(c.url).pathname.endsWith('/rest/v1/student_fee_balances'))
    .toArray()
  const changed = []
  for (const c of entries) {
    try {
      const arr = JSON.parse(c.body) as Row[]
      if (!Array.isArray(arr)) continue
      const next = arr.map((o) =>
        o.student_id === pay.student_id && o.fee_structure_id === pay.fee_structure_id
          ? { ...o, amount_paid: Number(o.amount_paid) + amt, balance: Number(o.balance) - amt }
          : o,
      )
      changed.push({ ...c, body: JSON.stringify(next) })
    } catch {
      /* skip */
    }
  }
  if (changed.length) await db.cache.bulkPut(changed)
}

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  inflight++
  try {
    return await handle(input, init)
  } finally {
    inflight--
    lastEnd = Date.now()
  }
}
export async function waitForIdle(minMs = 1200, maxMs = 15000) {
  const start = Date.now()
  await new Promise((r) => setTimeout(r, minMs))
  while (Date.now() - start < maxMs && (inflight > 0 || Date.now() - lastEnd < 700)) {
    await new Promise((r) => setTimeout(r, 200))
  }
}
