import Dexie, { type EntityTable } from 'dexie'

export interface CacheRow {
  key: string
  userId: string
  url: string
  status: number
  body: string
  ctype: string
  range: string | null
  ts: number
}
export interface OutboxRow {
  id?: number
  userId: string
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
  table: string
  ts: number
  failed?: number
  error?: string
  tempNo?: string
}
export interface ReceiptMapRow {
  tempNo: string
  receiptNo: string
  userId: string
  ts: number
}
export interface CredRow {
  email: string
  userId: string
  salt: string
  hash: string
  iter: number
  profile: unknown
  ts: number
  mfa?: boolean
}

export const db = new Dexie('sat-hub') as Dexie & {
  cache: EntityTable<CacheRow, 'key'>
  outbox: EntityTable<OutboxRow, 'id'>
  creds: EntityTable<CredRow, 'email'>
  receipts: EntityTable<ReceiptMapRow, 'tempNo'>
}
db.version(1).stores({ cache: 'key, userId, url, ts', outbox: '++id, userId', creds: 'email' })
db.version(2).stores({ cache: 'key, userId, url, ts', outbox: '++id, userId', creds: 'email', receipts: 'tempNo, userId' })

// Which user's data the fetch layer may cache/serve (set by AuthProvider)
let currentUser: string | null = null
export const setOfflineUser = (id: string | null) => {
  currentUser = id
}
export const getOfflineUser = () => currentUser

export const OUTBOX_EVENT = 'hub-outbox'
export const notifyOutbox = () => window.dispatchEvent(new Event(OUTBOX_EVENT))

/** Drop cache entries older than 30 days */
export function pruneCache() {
  return db.cache.where('ts').below(Date.now() - 30 * 86400000).delete()
}

/* ---- offline password check (PBKDF2, never stores the password) ---- */
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
    key,
    256,
  )
  return b64(bits)
}

export async function saveCred(email: string, userId: string, password: string, profile: unknown, mfa = false) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iter = 150000
  await db.creds.put({
    email: email.trim().toLowerCase(),
    userId,
    salt: b64(salt),
    hash: await derive(password, salt, iter),
    iter,
    profile,
    ts: Date.now(),
    mfa,
  })
}

export async function checkCred(email: string, password: string): Promise<CredRow | 'none' | 'wrong'> {
  const row = await db.creds.get(email.trim().toLowerCase())
  if (!row) return 'none'
  const h = await derive(password, unb64(row.salt), row.iter)
  return h === row.hash ? row : 'wrong'
}

/** Erase locally saved school data (not the unsent-changes queue, which must still sync). */
export async function wipeLocalData() {
  await db.cache.clear()
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('sat-hub-warm') || k === 'sat-hub-offline-ready' || k.startsWith('sat-term-')) localStorage.removeItem(k)
  }
}
