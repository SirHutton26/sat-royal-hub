import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  Loader2,
  Download,
  ChevronDown,
  HandCoins,
  Ban,
  Eye,
  Printer,
  MessageSquare,
  MessageSquareWarning,
  FileDown,
  LogIn,
  LogOut,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { money } from '@/components/fees/fee-utils'

/* ---------- types & constants ---------- */

interface AuditRow {
  id: number
  created_at: string
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string
  details: Record<string, unknown> | null
}

const PAGE_SIZE = 50
const EXPORT_LIMIT = 2000

const ACTION_META: Record<string, { label: string; icon: LucideIcon; chip: string }> = {
  'payment.recorded': { label: 'Payment', icon: HandCoins, chip: 'bg-emerald-50 text-emerald-700' },
  'payment.voided': { label: 'Void', icon: Ban, chip: 'bg-red-50 text-red-600' },
  'receipt.viewed': { label: 'Receipt viewed', icon: Eye, chip: 'bg-royal-600/10 text-royal-700' },
  'receipt.printed': { label: 'Receipt printed', icon: Printer, chip: 'bg-royal-600/10 text-royal-700' },
  'sms.sent': { label: 'SMS sent', icon: MessageSquare, chip: 'bg-sky-50 text-sky-700' },
  'sms.failed': { label: 'SMS failed', icon: MessageSquareWarning, chip: 'bg-amber-50 text-amber-700' },
  'report.exported': { label: 'Export', icon: FileDown, chip: 'bg-gold-400/25 text-royal-900' },
  'log.exported': { label: 'Export', icon: FileDown, chip: 'bg-gold-400/25 text-royal-900' },
  'attendance.clock_in': { label: 'Check-in', icon: LogIn, chip: 'bg-violet-50 text-violet-700' },
  'attendance.clock_out': { label: 'Sign-out', icon: LogOut, chip: 'bg-violet-50 text-violet-700' },
}
const FALLBACK_META = { label: 'Activity', icon: ClipboardList, chip: 'bg-gray-100 text-gray-600' }

const CATEGORIES: { value: string; label: string; actions: string[] }[] = [
  { value: 'all', label: 'All activity', actions: [] },
  { value: 'payments', label: 'Payments', actions: ['payment.recorded'] },
  { value: 'voids', label: 'Voids', actions: ['payment.voided'] },
  { value: 'receipts', label: 'Receipts', actions: ['receipt.viewed', 'receipt.printed'] },
  { value: 'sms', label: 'SMS', actions: ['sms.sent', 'sms.failed'] },
  { value: 'exports', label: 'Exports', actions: ['report.exported', 'log.exported'] },
  { value: 'attendance', label: 'Attendance', actions: ['attendance.clock_in', 'attendance.clock_out'] },
]

type Range = 'today' | '7d' | '30d' | 'all' | 'custom'
const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100 sm:text-sm'

/* ---------- helpers ---------- */

function startOfDay(d: Date) {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dayHeading(iso: string) {
  const d = new Date(iso)
  const today = startOfDay(new Date())
  const diff = Math.round((today.getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function humanKey(key: string) {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatDetail(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number' && /amount|balance/.test(key)) return money(value)
  if (key === 'time' && typeof value === 'string') {
    return new Date(value).toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const text = rows.map((r) => r.map(esc).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------- page ---------- */

export default function BursarActivity() {
  const [range, setRange] = useState<Range>('7d')
  const [from, setFrom] = useState(localISO(new Date()))
  const [to, setTo] = useState(localISO(new Date()))
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  // wait for the bursar to stop typing before querying
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])

  // resolve the chosen range to timestamps
  const bounds = useMemo(() => {
    const now = new Date()
    if (range === 'today') return { gte: startOfDay(now), lt: null as Date | null }
    if (range === '7d') {
      const d = startOfDay(now)
      d.setDate(d.getDate() - 6)
      return { gte: d, lt: null }
    }
    if (range === '30d') {
      const d = startOfDay(now)
      d.setDate(d.getDate() - 29)
      return { gte: d, lt: null }
    }
    if (range === 'custom') {
      const end = parseLocal(to)
      end.setDate(end.getDate() + 1)
      return { gte: parseLocal(from), lt: end }
    }
    return { gte: null as Date | null, lt: null as Date | null }
  }, [range, from, to])

  const buildQuery = useCallback(
    (withCount: boolean) => {
      let q = supabase
        .from('audit_logs')
        .select('*', withCount ? { count: 'exact' } : undefined)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (bounds.gte) q = q.gte('created_at', bounds.gte.toISOString())
      if (bounds.lt) q = q.lt('created_at', bounds.lt.toISOString())
      const actions = CATEGORIES.find((c) => c.value === category)?.actions ?? []
      if (actions.length > 0) q = q.in('action', actions)
      if (debounced) q = q.ilike('summary', `%${debounced.replace(/[%_\\]/g, (m) => '\\' + m)}%`)
      return q
    },
    [bounds, category, debounced],
  )

  // first page, whenever a filter changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setOpen(null)
      const { data, count, error: err } = await buildQuery(true).range(0, PAGE_SIZE - 1)
      if (cancelled) return
      if (err) setError(err.message)
      setRows((data ?? []) as AuditRow[])
      setTotal(count ?? 0)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [buildQuery])

  async function loadMore() {
    setLoadingMore(true)
    const { data, error: err } = await buildQuery(false).range(rows.length, rows.length + PAGE_SIZE - 1)
    if (err) setError(err.message)
    setRows((prev) => [...prev, ...((data ?? []) as AuditRow[])])
    setLoadingMore(false)
  }

  async function exportCsv() {
    setExporting(true)
    const { data, error: err } = await buildQuery(false).range(0, EXPORT_LIMIT - 1)
    setExporting(false)
    if (err) return setError(err.message)
    const list = (data ?? []) as AuditRow[]
    logAudit('log.exported', `Exported ${list.length} activity log entries`, undefined, {
      report: 'activity_log',
      rows: list.length,
      filter: CATEGORIES.find((c) => c.value === category)?.label,
    })
    downloadCsv(`activity-log-${localISO(new Date())}.csv`, [
      ['Date', 'Time', 'Who', 'Action', 'Summary', 'Details'],
      ...list.map((r) => [
        new Date(r.created_at).toLocaleDateString('en-GH'),
        new Date(r.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }),
        r.actor_name ?? '',
        (ACTION_META[r.action] ?? FALLBACK_META).label,
        r.summary,
        r.details ? JSON.stringify(r.details) : '',
      ]),
    ])
  }

  // group the loaded rows under day headings
  const groups = useMemo(() => {
    const out: { heading: string; rows: AuditRow[] }[] = []
    for (const r of rows) {
      const heading = dayHeading(r.created_at)
      const last = out[out.length - 1]
      if (last && last.heading === heading) last.rows.push(r)
      else out.push({ heading, rows: [r] })
    }
    return out
  }, [rows])

  const filtersActive = category !== 'all' || debounced !== '' || range !== '7d'

  function reset() {
    setRange('7d')
    setCategory('all')
    setSearch('')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Activity Log</h1>
          <p className="mt-1 text-sm text-gray-500">A permanent record of what you do in the Fees Office. Entries cannot be edited or deleted.</p>
        </div>
        <button
          onClick={() => void exportCsv()}
          disabled={exporting || loading || total === 0}
          className="flex items-center gap-2 rounded-lg bg-royal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-royal-600 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="mt-5 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                range === r.value ? 'bg-royal-600 text-white shadow' : 'bg-white text-gray-600 hover:bg-royal-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="text-xs font-medium text-gray-500">
              From
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className={`${inputClass} mt-1 w-full`}
              />
            </label>
            <label className="text-xs font-medium text-gray-500">
              To
              <input
                type="date"
                value={to}
                min={from}
                max={localISO(new Date())}
                onChange={(e) => setTo(e.target.value)}
                className={`${inputClass} mt-1 w-full`}
              />
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search receipt no, student or amount"
              className={`${inputClass} w-full pl-9`}
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} w-full`}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span>
          {loading ? 'Loading…' : `${total.toLocaleString('en-GH')} ${total === 1 ? 'entry' : 'entries'}`}
        </span>
        {filtersActive && (
          <button onClick={reset} className="font-semibold text-royal-700 hover:underline">
            Reset filters
          </button>
        )}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="mt-3 flex justify-center rounded-2xl bg-white py-16 shadow-sm">
          <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-white px-4 py-16 text-center shadow-sm">
          <ClipboardList className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-royal-900">No activity found</p>
          <p className="mt-1 text-xs text-gray-500">Try a wider date range or clear the filters.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <section key={g.heading}>
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.heading}</h2>
              <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-2xl bg-white shadow-sm">
                {g.rows.map((r) => {
                  const meta = ACTION_META[r.action] ?? FALLBACK_META
                  const Icon = meta.icon
                  const isOpen = open === r.id
                  const details = Object.entries(r.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => setOpen(isOpen ? null : r.id)}
                        aria-expanded={isOpen}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-gray-50"
                      >
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.chip}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-royal-900">{r.summary}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                            <span>{new Date(r.created_at).toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.chip}`}>
                              {meta.label}
                            </span>
                            {r.actor_name && <span>by {r.actor_name}</span>}
                          </span>
                        </span>
                        {details.length > 0 && (
                          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                        )}
                      </button>

                      {isOpen && details.length > 0 && (
                        <dl className="grid gap-x-6 gap-y-2 bg-gray-50 px-4 py-3 pl-16 text-xs sm:grid-cols-2">
                          {details.map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <dt className="text-gray-500">{humanKey(k)}</dt>
                              <dd className="break-words font-medium text-royal-900">{formatDetail(k, v)}</dd>
                            </div>
                          ))}
                          <div className="min-w-0 sm:col-span-2">
                            <dt className="text-gray-500">Recorded at</dt>
                            <dd className="font-medium text-royal-900">
                              {new Date(r.created_at).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'medium' })}
                            </dd>
                          </div>
                        </dl>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {rows.length < total && (
            <div className="flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-royal-700 shadow-sm transition hover:bg-royal-50 disabled:opacity-60"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more ({total - rows.length} left)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}