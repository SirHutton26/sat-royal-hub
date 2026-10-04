import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Star,
  Wallet,
  Banknote,
  History,
  Users,
  CalendarDays,
  Coins,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

/* ---------- types & constants ---------- */

interface ClassRow {
  id: string
  name: string
  level_group: string | null
}

interface FeeRow {
  id: string
  class_id: string | null // set when a fee is for single classes rather than a whole level
  level_group: string | null // set on level fees
  academic_year: string
  term: string
  item: string
  amount: number
  classes: { name: string } | null
}

interface TermStats {
  billed: number
  collected: number
  outstanding: number
  students_billed: number
  students_owing: number
  arrears: number
  students_with_arrears: number
  collected_today: number
}

// One amount and the levels / individual classes that pay it (the bursar's list is written this way)
interface FeeGroup {
  key: number
  amount: string
  levels: Set<string> // whole levels (also covers classes added to the level later)
  classIds: Set<string> // individual classes, for levels that are only partly covered
}

let groupCounter = 0
const newGroup = (): FeeGroup => ({ key: ++groupCounter, amount: '', levels: new Set(), classIds: new Set() })

type ModalState = null | { mode: 'add' } | { mode: 'edit'; row: FeeRow }

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const ITEM_SUGGESTIONS = ['School Fees', 'Exam Fees', 'PTA Levy', 'Feeding Fee', 'Books & Stationery']

// Same levels as the Classes page
const LEVELS = [
  { value: 'creche', label: 'Creche' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'kg', label: 'KG' },
  { value: 'lower_primary', label: 'Lower Primary (Basic 1–3)' },
  { value: 'upper_primary', label: 'Upper Primary (Basic 4–6)' },
  { value: 'jhs', label: 'JHS (Basic 7–9)' },
]
const LEVEL_LABEL: Record<string, string> = Object.fromEntries(LEVELS.map((l) => [l.value, l.label]))
const LEVEL_ORDER: Record<string, number> = Object.fromEntries(LEVELS.map((l, i) => [l.value, i]))

function defaultYear() {
  const d = new Date()
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}/${start + 1}`
}

function yearOptions(extra: string) {
  const start = Number(defaultYear().slice(0, 4))
  const base = [start - 1, start, start + 1].map((n) => `${n}/${n + 1}`)
  return base.includes(extra) ? base : [...base, extra].sort()
}

const money = (n: number) =>
  'GH₵ ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ---------- small UI helpers ---------- */

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
      <div className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-xl ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-royal-900">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

/* ---------- page ---------- */

export default function AdminFees() {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [rows, setRows] = useState<FeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const [year, setYear] = useState(defaultYear())
  const [term, setTerm] = useState(TERMS[0])
  const [current, setCurrent] = useState<{ year: string | null; term: string | null }>({ year: null, term: null })
  const [settingsId, setSettingsId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [modal, setModal] = useState<ModalState>(null)
  const [toDelete, setToDelete] = useState<FeeRow | null>(null)

  // payment stats for the selected term
  const [stats, setStats] = useState<TermStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // form state (shared by add / edit)
  const [item, setItem] = useState('')
  const [amount, setAmount] = useState('')
  const [groups, setGroups] = useState<FeeGroup[]>([newGroup()])
  const [formError, setFormError] = useState<string | null>(null)

  function showToast(type: 'ok' | 'error', text: string) {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 3500)
  }

  /* ----- initial data: classes + current term ----- */
  useEffect(() => {
    async function init() {
      const [{ data: cls }, { data: settings }] = await Promise.all([
        supabase.from('classes').select('id, name, level_group').order('name'),
        supabase
          .from('school_settings')
          .select('id, current_academic_year, current_term')
          .limit(1)
          .maybeSingle(),
      ])

      const sorted = ((cls ?? []) as ClassRow[]).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      setClasses(sorted)

      if (settings) {
        setSettingsId(String(settings.id))
        setCurrent({ year: settings.current_academic_year, term: settings.current_term })
        if (settings.current_academic_year) setYear(settings.current_academic_year)
        if (settings.current_term) setTerm(settings.current_term)
      }
    }
    void init()
  }, [])

  /* ----- fee rows for the selected year + term ----- */
  const loadRows = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fee_structures')
      .select('id, class_id, level_group, academic_year, term, item, amount, classes(name)')
      .is('student_id', null) // level and class fees; per-student opening balances live on their own page
      .eq('academic_year', year)
      .eq('term', term)
    if (error) showToast('error', error.message)
    setRows(((data ?? []) as unknown as FeeRow[]).map((r) => ({ ...r, amount: Number(r.amount) })))
    setLoading(false)
  }, [year, term])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  /* ----- derived ----- */
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const classesByLevel = useMemo(() => {
    const map = new Map<string, ClassRow[]>()
    for (const c of classes) {
      if (!c.level_group) continue
      map.set(c.level_group, [...(map.get(c.level_group) ?? []), c])
    }
    return map
  }, [classes])

  const unlevelled = classes.filter((c) => !c.level_group)

  const levelOf = useCallback(
    (r: FeeRow) => r.level_group ?? (r.class_id ? classById.get(r.class_id)?.level_group ?? null : null),
    [classById],
  )

  const appliesTo = (r: FeeRow) => (r.level_group ? LEVEL_LABEL[r.level_group] ?? r.level_group : r.classes?.name ?? '—')

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => (levelFilter === 'all' ? true : levelOf(r) === levelFilter))
      .filter((r) => !q || r.item.toLowerCase().includes(q) || appliesTo(r).toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (LEVEL_ORDER[levelOf(a) ?? ''] ?? 99) - (LEVEL_ORDER[levelOf(b) ?? ''] ?? 99) ||
          Number(!!a.class_id) - Number(!!b.class_id) ||
          appliesTo(a).localeCompare(appliesTo(b), undefined, { numeric: true }) ||
          a.item.localeCompare(b.item),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, levelFilter, levelOf])

  const isCurrent = current.year === year && current.term === term

  /* ----- actions ----- */
  async function setAsCurrent() {
    if (!settingsId) {
      showToast('error', 'School settings row not found')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('school_settings')
      .update({ current_academic_year: year, current_term: term })
      .eq('id', settingsId)
    setSaving(false)
    if (error) return showToast('error', error.message)
    setCurrent({ year, term })
    showToast('ok', `${term} ${year} is now the current term`)
  }

  function openAdd() {
    setItem('')
    setAmount('')
    setGroups([newGroup()])
    setFormError(null)
    setModal({ mode: 'add' })
  }

  function openEdit(row: FeeRow) {
    setItem(row.item)
    setAmount(String(row.amount))
    setFormError(null)
    setModal({ mode: 'edit', row })
  }

  function updateGroup(key: number, patch: Partial<FeeGroup>) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)))
  }

  // Ticking a whole level replaces any individual classes picked in it
  function toggleLevel(key: number, level: string) {
    setGroups((gs) =>
      gs.map((g) => {
        if (g.key !== key) return g
        const levels = new Set(g.levels)
        const classIds = new Set(g.classIds)
        if (levels.has(level)) levels.delete(level)
        else {
          levels.add(level)
          for (const c of classesByLevel.get(level) ?? []) classIds.delete(c.id)
        }
        return { ...g, levels, classIds }
      }),
    )
  }

  // Tapping a class: splits a whole level into its classes, and merges back to the level when every class is picked
  function toggleClass(key: number, c: ClassRow) {
    if (!c.level_group) return
    const level = c.level_group
    setGroups((gs) =>
      gs.map((g) => {
        if (g.key !== key) return g
        const levels = new Set(g.levels)
        const classIds = new Set(g.classIds)
        const inLevel = classesByLevel.get(level) ?? []
        if (levels.has(level)) {
          levels.delete(level)
          for (const x of inLevel) if (x.id !== c.id) classIds.add(x.id)
        } else if (classIds.has(c.id)) {
          classIds.delete(c.id)
        } else {
          classIds.add(c.id)
          if (inLevel.every((x) => classIds.has(x.id))) {
            for (const x of inLevel) classIds.delete(x.id)
            levels.add(level)
          }
        }
        return { ...g, levels, classIds }
      }),
    )
  }

  async function saveForm() {
    const name = item.trim()
    if (!name) return setFormError('Enter a fee item name')
    const sameName = (r: FeeRow) => r.item.trim().toLowerCase() === name.toLowerCase()

    if (modal?.mode === 'add') {
      // Groups the admin never touched are ignored
      const used = groups.filter((g) => g.amount !== '' || g.levels.size > 0 || g.classIds.size > 0)
      if (used.length === 0) return setFormError('Enter an amount and choose who pays it')

      const seenLevel = new Set<string>()
      const seenClass = new Set<string>()
      const levelPayload: { level_group: string; amount: number }[] = []
      const classPayload: { class: ClassRow; amount: number }[] = []

      for (const g of used) {
        const value = Number(g.amount)
        if (g.amount === '' || Number.isNaN(value) || value < 0) return setFormError('Enter a valid amount for every group')
        if (g.levels.size === 0 && g.classIds.size === 0) return setFormError(`Choose who pays GH₵ ${g.amount}`)

        for (const level of g.levels) {
          if (seenLevel.has(level)) return setFormError(`${LEVEL_LABEL[level]} is in more than one group`)
          seenLevel.add(level)
          for (const c of classesByLevel.get(level) ?? []) {
            if (seenClass.has(c.id)) return setFormError(`${c.name} is in more than one group`)
            seenClass.add(c.id)
          }
          levelPayload.push({ level_group: level, amount: value })
        }
        for (const id of g.classIds) {
          const c = classById.get(id)
          if (!c) continue
          if (seenClass.has(id)) return setFormError(`${c.name} is in more than one group`)
          seenClass.add(id)
          classPayload.push({ class: c, amount: value })
        }
      }

      // A level fee and a class fee with the same name would charge the same student twice
      for (const l of levelPayload) {
        const clash = rows.filter((r) => r.class_id && levelOf(r) === l.level_group && sameName(r))
        if (clash.length > 0) {
          return setFormError(
            `${clash.map((r) => r.classes?.name).join(', ')} already ${clash.length === 1 ? 'has' : 'have'} "${name}" set for the class alone. Delete that class fee first so students aren't charged twice.`,
          )
        }
      }
      for (const c of classPayload) {
        const covering = rows.find((r) => !r.class_id && r.level_group === c.class.level_group && sameName(r))
        if (covering) {
          return setFormError(
            `"${name}" is already set for all of ${LEVEL_LABEL[covering.level_group ?? ''] ?? 'that level'}, which includes ${c.class.name}. Delete that level fee first to price its classes separately.`,
          )
        }
      }

      setSaving(true)
      let failure: string | null = null

      // If a level already has this item for the term, its amount is updated
      if (levelPayload.length > 0) {
        const { error } = await supabase.from('fee_structures').upsert(
          levelPayload.map((l) => ({ ...l, academic_year: year, term, item: name })),
          { onConflict: 'level_group,academic_year,term,item' },
        )
        if (error) failure = error.message
      }

      // Single classes: update the existing fee for that class, otherwise add one
      const toInsert: object[] = []
      for (const c of classPayload) {
        const existing = rows.find((r) => r.class_id === c.class.id && sameName(r))
        if (existing) {
          const { error } = await supabase.from('fee_structures').update({ amount: c.amount }).eq('id', existing.id)
          if (error && !failure) failure = error.message
        } else {
          toInsert.push({ class_id: c.class.id, academic_year: year, term, item: name, amount: c.amount })
        }
      }
      if (toInsert.length > 0) {
        const { error } = await supabase.from('fee_structures').insert(toInsert)
        if (error && !failure) failure = error.message
      }
      setSaving(false)
      if (failure) {
        await loadRows()
        return setFormError(`Some fees could not be saved: ${failure}`)
      }
      const parts = []
      if (levelPayload.length) parts.push(`${levelPayload.length} ${levelPayload.length === 1 ? 'level' : 'levels'}`)
      if (classPayload.length) parts.push(`${classPayload.length} ${classPayload.length === 1 ? 'class' : 'classes'}`)
      showToast('ok', `${name} saved for ${parts.join(' and ')}`)
    } else if (modal?.mode === 'edit') {
      const value = Number(amount)
      if (amount === '' || Number.isNaN(value) || value < 0) return setFormError('Enter a valid amount')
      const row = modal.row
      setSaving(true)

      // Don't allow an amount lower than what any one student has already paid
      const paidPerStudent = await maxPaidByOneStudent(row.id)
      if (value < paidPerStudent) {
        setSaving(false)
        return setFormError(
          `A student has already paid ${money(paidPerStudent)} on this item, so the amount can't be lower.`,
        )
      }

      const { error } = await supabase.from('fee_structures').update({ item: name, amount: value }).eq('id', row.id)
      setSaving(false)
      if (error) {
        return setFormError(
          error.code === '23505' ? 'This level already has an item with that name' : error.message,
        )
      }
      showToast('ok', 'Fee updated')
    }

    setModal(null)
    await loadRows()
  }

  async function maxPaidByOneStudent(feeStructureId: string) {
    const { data } = await supabase
      .from('fee_payments')
      .select('student_id, amount')
      .eq('fee_structure_id', feeStructureId)
      .eq('status', 'valid')
    const totals = new Map<string, number>()
    for (const p of data ?? []) {
      totals.set(p.student_id, (totals.get(p.student_id) ?? 0) + Number(p.amount))
    }
    return Math.max(0, ...totals.values())
  }

  async function confirmDelete() {
    if (!toDelete) return
    setSaving(true)
    const { error } = await supabase.from('fee_structures').delete().eq('id', toDelete.id)
    setSaving(false)
    if (error) {
      showToast(
        'error',
        error.code === '23503'
          ? 'This fee already has payments recorded, so it cannot be deleted'
          : error.message,
      )
    } else {
      showToast('ok', 'Fee deleted')
      await loadRows()
    }
    setToDelete(null)
  }

  /* ----- payment stats; refreshed when the term changes or the fee list is edited ----- */
  useEffect(() => {
    let cancelled = false
    async function loadStats() {
      setStatsLoading(true)
      const { data, error } = await supabase.rpc('fee_term_summary', { p_year: year, p_term: term })
      if (cancelled) return
      if (error) {
        setStats(null)
        showToast('error', `Could not load payment stats: ${error.message}`)
      } else {
        const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
        setStats(
          r
            ? {
                billed: Number(r.billed),
                collected: Number(r.collected),
                outstanding: Number(r.outstanding),
                students_billed: Number(r.students_billed),
                students_owing: Number(r.students_owing),
                arrears: Number(r.arrears),
                students_with_arrears: Number(r.students_with_arrears),
                collected_today: Number(r.collected_today),
              }
            : null,
        )
      }
      setStatsLoading(false)
    }
    void loadStats()
    return () => {
      cancelled = true
    }
  }, [year, term, rows])

  const statCards = [
    {
      label: 'Total billed',
      value: money(stats?.billed ?? 0),
      sub: `${stats?.students_billed ?? 0} students billed`,
      icon: Wallet,
      chip: 'bg-royal-600/10 text-royal-700',
      tone: 'text-royal-900',
    },
    {
      label: 'Collected',
      value: money(stats?.collected ?? 0),
      sub: `${stats && stats.billed > 0 ? Math.min(100, Math.round((stats.collected / stats.billed) * 100)) : 0}% of billed`,
      icon: Banknote,
      chip: 'bg-gold-400/20 text-gold-500',
      tone: 'text-royal-900',
    },
    {
      label: 'Outstanding',
      value: money(stats?.outstanding ?? 0),
      sub: 'This term only',
      icon: AlertCircle,
      chip: 'bg-red-50 text-red-600',
      tone: 'text-red-600',
    },
    {
      label: 'Arrears b/f',
      value: money(stats?.arrears ?? 0),
      sub: `${stats?.students_with_arrears ?? 0} students, previous terms`,
      icon: History,
      chip: 'bg-amber-50 text-amber-700',
      tone: 'text-amber-700',
    },
    {
      label: 'Students owing',
      value: String(stats?.students_owing ?? 0),
      sub: `of ${stats?.students_billed ?? 0} billed this term`,
      icon: Users,
      chip: 'bg-royal-600/10 text-royal-700',
      tone: 'text-royal-900',
    },
    {
      label: 'Collected today',
      value: money(stats?.collected_today ?? 0),
      sub: 'All terms',
      icon: CalendarDays,
      chip: 'bg-gold-400/20 text-gold-500',
      tone: 'text-royal-900',
    },
  ]

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Fees</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set what each level pays, per term and fee item. Every class in a level is charged the same.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/daily-rates"
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
          >
            <Coins className="h-4 w-4" />
            Daily rates
          </Link>
          <Link
            to="/admin/fees/arrears"
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-4 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
          >
            <History className="h-4 w-4" />
            Opening balances
          </Link>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" />
            Add Fee
          </button>
        </div>
      </div>

      {/* Classes with no level are never billed */}
      {unlevelled.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>{unlevelled.map((c) => c.name).join(', ')}</b> {unlevelled.length === 1 ? 'has' : 'have'} no level set, so
            no fees apply to {unlevelled.length === 1 ? 'it' : 'them'}. Set the level on the Class page.
          </p>
        </div>
      )}

      {/* Year / term selector */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-500">Academic year</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={`${inputClass} mt-1 w-40`}>
            {yearOptions(year).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Term</label>
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={`${inputClass} mt-1 w-36`}>
            {TERMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {isCurrent ? (
            <span className="flex items-center gap-1.5 rounded-full bg-gold-400/20 px-3 py-1.5 text-xs font-semibold text-royal-900">
              <Star className="h-3.5 w-3.5 fill-gold-400 text-gold-500" />
              Current term
            </span>
          ) : (
            <button
              onClick={() => void setAsCurrent()}
              className="rounded-lg border border-royal-200 px-3 py-2 text-xs font-semibold text-royal-700 transition hover:bg-royal-50"
            >
              Set as current term
            </button>
          )}
        </div>
      </div>

      {/* Payment stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {statCards.map(({ label, value, sub, icon: Icon, chip, tone }) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${chip}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <p className={`mt-2 truncate text-xl font-bold ${tone}`}>
              {statsLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-300" /> : value}
            </p>
            {!statsLoading && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search level or fee item"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className={`${inputClass} w-56`}
        >
          <option value="all">All levels</option>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">SN</th>
              <th className="px-4 py-3 font-semibold">Applies to</th>
              <th className="px-4 py-3 font-semibold">Fee item</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  No fees set for {term}, {year} yet. Click <b>Add Fee</b> to create one.
                </td>
              </tr>
            ) : (
              visibleRows.map((r, i) => {
                const levelClasses = r.level_group ? classesByLevel.get(r.level_group) ?? [] : []
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-royal-50/60">
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-royal-900">
                        {appliesTo(r)}
                        {r.class_id && (
                          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                            Class only
                          </span>
                        )}
                      </p>
                      {r.level_group && (
                        <p className="text-xs text-gray-500">
                          {levelClasses.length > 0 ? levelClasses.map((c) => c.name).join(', ') : 'No classes in this level yet'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{r.item}</td>
                    <td className="px-4 py-3 text-right font-semibold text-royal-900">{money(r.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(r)}
                          aria-label="Edit"
                          className="rounded-md p-2 text-royal-600 transition hover:bg-royal-50"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(r)}
                          aria-label="Delete"
                          className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / edit modal */}
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add fee' : 'Edit fee'} onClose={() => setModal(null)} wide={modal.mode === 'add'}>
          <p className="text-xs text-gray-500">
            {term}, {year}
            {modal.mode === 'edit' ? ` · ${appliesTo(modal.row)}` : ''}
          </p>

          <label className="mt-4 block text-sm font-medium text-royal-900">Fee item</label>
          <input
            list="fee-item-suggestions"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. School Fees"
            className={`${inputClass} mt-1`}
          />
          <datalist id="fee-item-suggestions">
            {ITEM_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          {modal.mode === 'edit' && (
            <>
              <label className="mt-4 block text-sm font-medium text-royal-900">Amount (GH₵)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${inputClass} mt-1`}
              />
            </>
          )}
          {modal.mode === 'edit' && modal.row.level_group && (
            <p className="mt-2 text-xs text-gray-500">
              This changes the amount for every class in {appliesTo(modal.row)}.
            </p>
          )}

          {modal.mode === 'add' && (
            <div className="mt-4 space-y-3">
              {groups.map((g, gi) => (
                <div key={g.key} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-royal-900">
                        Amount (GH₵){groups.length > 1 ? ` · group ${gi + 1}` : ''}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={g.amount}
                        onChange={(e) => updateGroup(g.key, { amount: e.target.value })}
                        placeholder="0.00"
                        className={`${inputClass} mt-1`}
                      />
                    </div>
                    {groups.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}
                        aria-label="Remove this group"
                        className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <p className="mt-3 text-sm font-medium text-royal-900">Who pays this</p>
                  <div className="mt-1 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-gray-100 p-2">
                    {LEVELS.map((l) => {
                      const inLevel = classesByLevel.get(l.value) ?? []
                      return (
                        <div key={l.value}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-royal-50">
                            <input
                              type="checkbox"
                              checked={g.levels.has(l.value)}
                              onChange={() => toggleLevel(g.key, l.value)}
                              className="h-4 w-4 accent-royal-600"
                            />
                            <span className="text-sm font-medium text-gray-800">{l.label}</span>
                            {inLevel.length === 0 && <span className="text-xs text-gray-400">No classes yet</span>}
                          </label>
                          {inLevel.length > 0 && (
                            <div className="ml-7 mt-1 flex flex-wrap gap-1.5">
                              {inLevel.map((c) => {
                                const on = g.levels.has(l.value) || g.classIds.has(c.id)
                                return (
                                  <button
                                    type="button"
                                    key={c.id}
                                    onClick={() => toggleClass(g.key, c)}
                                    aria-pressed={on}
                                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                                      on
                                        ? 'border-royal-600 bg-royal-600 text-white'
                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-royal-50'
                                    }`}
                                  >
                                    {c.name}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setGroups((gs) => [...gs, newGroup()])}
                className="flex items-center gap-1.5 text-xs font-semibold text-royal-600 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another amount for this fee
              </button>
              <p className="text-xs text-gray-500">
                Tick a whole level, or tap individual classes when only some of them pay this amount (for example JHS 3 pays
                more than JHS 1 and 2). If a level or class already has this fee item, its amount is updated.
              </p>
            </div>
          )}

          {formError && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setModal(null)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveForm()}
              className="rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-royal-700"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {toDelete && (
        <Modal title="Delete this fee?" onClose={() => setToDelete(null)}>
          <p className="text-sm text-gray-600">
            {toDelete.item} for {appliesTo(toDelete)} ({money(toDelete.amount)}) will be removed
            {toDelete.level_group ? ' for every class in that level' : ''}. Fees that already have payments can&apos;t be
            deleted.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setToDelete(null)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}

      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/30 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {toast.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}