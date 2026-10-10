import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, ShieldCheck, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Entry {
  id: number
  created_at: string
  user_id: string | null
  user_name: string | null
  user_role: string | null
  action: string
  entity: string
  label: string | null
  details: Record<string, unknown> | null
}
interface UserCard {
  id: string
  full_name: string | null
  email: string | null
  role: string
}

const ENTITY: Record<string, string> = {
  students: 'student', classes: 'class', profiles: 'account', subjects: 'subject', subject_assignments: 'subject assignment',
  school_settings: 'school settings', non_teaching_staff: 'non-teaching staff', alerts: 'alert', fee_structures: 'fee item',
  fee_payments: 'payment', attendance: 'attendance', staff_attendance: 'staff clock-in', exam_sessions: 'exam session',
  exam_scores: 'exam score', score_bank_entries: 'score bank entry', score_bank_scores: 'score bank score', sba_configs: 'SBA setup',
  sba_results: 'SBA result', grades: 'grade', daily_collections: 'daily collection', daily_feeding: 'daily feeding',
  daily_fee_rates: 'daily fee rate', store_items: 'store item', store_sales: 'store sale', store_submissions: 'money submitted', weekly_class_fee_remittances: 'weekly remittance', session: 'session',
}
const VERB: Record<string, string> = { create: 'Added', update: 'Changed', delete: 'Removed', login: 'Signed in', logout: 'Signed out' }
const BADGE: Record<string, string> = {
  create: 'bg-green-50 text-green-700',
  update: 'bg-blue-50 text-blue-700',
  delete: 'bg-red-50 text-red-700',
  login: 'bg-gray-100 text-gray-600',
  logout: 'bg-gray-100 text-gray-600',
  view: 'bg-sky-50 text-sky-700',
  click: 'bg-violet-50 text-violet-700',
  print: 'bg-amber-50 text-amber-700',
}
const FILTERS: { v: string; label: string; actions: string[] | null }[] = [
  { v: 'all', label: 'Everything', actions: null },
  { v: 'changes', label: 'Changes (add / edit / delete)', actions: ['create', 'update', 'delete'] },
  { v: 'pages', label: 'Pages opened', actions: ['view'] },
  { v: 'clicks', label: 'Buttons pressed', actions: ['click', 'print'] },
  { v: 'sessions', label: 'Sign in / out', actions: ['login', 'logout'] },
]
const RANGES = [
  { v: 1, label: 'Today' },
  { v: 7, label: 'Last 7 days' },
  { v: 30, label: 'Last 30 days' },
  { v: 0, label: 'All time' },
]
const PAGE = 100

const title = (e: Entry) =>
  e.action === 'login' || e.action === 'logout'
    ? VERB[e.action]
    : e.action === 'view'
      ? `Opened ${e.label ?? 'a page'}`
      : e.action === 'click'
        ? `Pressed "${e.label}"`
        : e.action === 'print'
          ? `Printed ${e.label ?? 'a page'}`
          : `${VERB[e.action] ?? e.action} ${ENTITY[e.entity] ?? e.entity.replace(/_/g, ' ')}${e.label ? ` "${e.label}"` : ''}`

interface Group {
  key: string
  first: Entry
  items: Entry[]
}
// Bulk saves (e.g. 40 attendance rows) become one line
function group(entries: Entry[]): Group[] {
  const out: Group[] = []
  for (const e of entries) {
    const g = out[out.length - 1]
    if (
      g && g.first.user_id === e.user_id && g.first.entity === e.entity && g.first.action === e.action && ['create', 'update', 'delete'].includes(e.action) &&
      new Date(g.items[g.items.length - 1].created_at).getTime() - new Date(e.created_at).getTime() < 120000
    ) g.items.push(e)
    else out.push({ key: String(e.id), first: e, items: [e] })
  }
  return out
}

function Details({ e }: { e: Entry }) {
  const d = e.details
  if (!d) return null
  if (['view', 'click', 'print'].includes(e.action)) return <p className="mt-0.5 text-xs text-gray-500">{e.action === 'view' ? '' : 'on '}{String(d.path ?? '')}</p>
  if (e.action === 'update') {
    return (
      <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
        {Object.entries(d).map(([k, v]) => {
          const x = v as { from: unknown; to: unknown }
          return (
            <li key={k}>
              <b>{k.replace(/_/g, ' ')}</b>: {String(x.from ?? '-')} <span className="text-gray-400">&rarr;</span> {String(x.to ?? '-')}
            </li>
          )
        })}
      </ul>
    )
  }
  const pairs = Object.entries(d).filter(([k, v]) => v !== null && v !== '' && !['id', 'created_at', 'updated_at'].includes(k) && typeof v !== 'object').slice(0, 8)
  return (
    <p className="mt-1 text-xs text-gray-600">{pairs.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}</p>
  )
}

function LogList({ userId, adminOnly }: { userId?: string; adminOnly?: boolean }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [days, setDays] = useState(7)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const fetchPage = useCallback(
    async (offset: number) => {
      let query = supabase.from('activity_log').select('*').order('created_at', { ascending: false }).range(offset, offset + PAGE - 1)
      if (userId) query = query.eq('user_id', userId)
      if (adminOnly) query = query.eq('user_role', 'admin')
      const acts = FILTERS.find((f) => f.v === filter)?.actions
      if (acts) query = query.in('action', acts)
      if (days > 0) query = query.gte('created_at', new Date(Date.now() - (days === 1 ? 0 : days * 86400000)).toISOString().slice(0, days === 1 ? 10 : 24))
      const { data } = await query
      return (data ?? []) as Entry[]
    },
    [userId, adminOnly, days, filter],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPage(0).then((d) => {
      if (!alive) return
      setRows(d)
      setMore(d.length === PAGE)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [fetchPage])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter((r) => title(r).toLowerCase().includes(s) || (r.user_name ?? '').toLowerCase().includes(s)) : rows
  }, [rows, q])
  const groups = useMemo(() => group(filtered), [filtered])

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity..." className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
        </select>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></div>
        ) : groups.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No activity found.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {groups.map((g) => {
              const e = g.first
              const expanded = open.has(g.key)
              return (
                <li key={g.key} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[e.action] ?? 'bg-gray-100'}`}>{e.action}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900">
                        {g.items.length > 1 ? `${VERB[e.action] ?? e.action} ${g.items.length} × ${ENTITY[e.entity] ?? e.entity}` : title(e)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {!userId && <>{e.user_name ?? 'Unknown'} {e.user_role && `(${e.user_role})`} · </>}
                        {new Date(e.created_at).toLocaleString()}
                      </p>
                      {(g.items.length === 1 || expanded) && g.items.slice(0, 60).map((it) => (
                        <div key={it.id}>
                          {g.items.length > 1 && <p className="mt-1 text-xs font-medium text-gray-700">{title(it)}</p>}
                          <Details e={it} />
                        </div>
                      ))}
                    </div>
                    {g.items.length > 1 && (
                      <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Expand">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {more && !loading && (
        <button
          onClick={async () => {
            const d = await fetchPage(rows.length)
            setRows([...rows, ...d])
            setMore(d.length === PAGE)
          }}
          className="mt-3 w-full rounded-lg border border-royal-200 bg-white py-2 text-sm font-semibold text-royal-700 hover:bg-royal-50"
        >
          Load more
        </button>
      )}
    </div>
  )
}

export default function AdminActivityLog() {
  const [view, setView] = useState<'menu' | 'admin' | 'users'>('menu')
  const [users, setUsers] = useState<UserCard[]>([])
  const [picked, setPicked] = useState<UserCard | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (view !== 'users' || users.length) return
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .neq('role', 'admin')
      .order('full_name')
      .then(({ data }) => setUsers((data ?? []) as UserCard[]))
  }, [view, users.length])

  const shown = users.filter((u) => `${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase()))
  const back = () => (picked ? setPicked(null) : setView('menu'))

  return (
    <div className="mx-auto max-w-4xl">
      {view !== 'menu' && (
        <button onClick={back} className="mb-2 flex items-center gap-1 text-sm text-royal-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <h1 className="text-2xl font-bold text-royal-900">
        {view === 'menu' ? 'Activity Log' : view === 'admin' ? 'Admin activity' : picked ? picked.full_name || picked.email : 'Users'}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {view === 'menu' ? 'See who did what in the system.' : view === 'users' && !picked ? 'Choose a user to see their actions.' : 'Newest first. Bulk saves are grouped into one line.'}
      </p>

      {view === 'menu' && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <button onClick={() => setView('admin')} className="rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-transparent transition hover:ring-royal-300">
            <ShieldCheck className="h-8 w-8 text-royal-700" />
            <p className="mt-3 text-lg font-semibold text-royal-900">Admin activity</p>
            <p className="mt-1 text-sm text-gray-500">Everything the admin has done.</p>
          </button>
          <button onClick={() => setView('users')} className="rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-transparent transition hover:ring-royal-300">
            <Users className="h-8 w-8 text-gold-500" />
            <p className="mt-3 text-lg font-semibold text-royal-900">Users</p>
            <p className="mt-1 text-sm text-gray-500">Teachers, bursar and other staff. Pick one to see their actions.</p>
          </button>
        </div>
      )}

      {view === 'admin' && <LogList adminOnly />}

      {view === 'users' && !picked && (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((u) => (
              <button key={u.id} onClick={() => setPicked(u)} className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-transparent transition hover:ring-royal-300">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-royal-600 font-bold text-white">{(u.full_name || u.email || '?')[0].toUpperCase()}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-royal-900">{u.full_name || u.email}</span>
                  <span className="block text-xs capitalize text-gray-500">{({ messenger: 'SMS officer', storekeeper: 'Store-keeper' } as Record<string, string>)[u.role] ?? u.role}</span>
                </span>
              </button>
            ))}
            {shown.length === 0 && <p className="text-sm text-gray-500">No users found.</p>}
          </div>
        </>
      )}

      {view === 'users' && picked && <LogList userId={picked.id} />}
    </div>
  )
}
