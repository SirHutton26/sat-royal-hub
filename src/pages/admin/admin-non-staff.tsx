import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Papa from 'papaparse'
import {
  Plus,
  Upload,
  Download,
  Pencil,
  Trash2,
  Search,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  UserCog,
  UserCheck,
  UserX,
  KeyRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import CreateLoginModal from '@/pages/admin/create-login-modal'

/* ---------- types & constants ---------- */

interface StaffRow {
  id: string
  full_name: string
  position: string
  phone_number: string | null
  email: string | null
  is_active: boolean
}

interface LoginProfile {
  email: string | null
  role: string
  is_active: boolean
}

const POSITION_SUGGESTIONS = [
  'Director',
  'Headteacher',
  'Assistant Headteacher',
  'Bursar',
  'SMS Officer',
  'Accountant',
  'Secretary',
  'Store-keeper',
  'Librarian',
  'School Nurse',
  'Driver',
  'Cook',
  'Security',
  'Cleaner',
  'Gardener',
]

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', teacher: 'Teacher', bursar: 'Bursar', messenger: 'SMS Officer', staff: 'Staff' }

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
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

/* ---------- page ---------- */

export default function AdminNonStaff() {
  const [rows, setRows] = useState<StaffRow[]>([])
  const [logins, setLogins] = useState<Map<string, LoginProfile>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const [search, setSearch] = useState('')
  const [positionFilter, setPositionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; row: StaffRow }>(null)
  const [toDelete, setToDelete] = useState<StaffRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // form state
  const [fullName, setFullName] = useState('')
  const [position, setPosition] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [loginFor, setLoginFor] = useState<StaffRow | null>(null)

  const toastTimer = useRef<number | undefined>(undefined)
  function showToast(type: 'ok' | 'error', text: string) {
    window.clearTimeout(toastTimer.current)
    setToast({ type, text })
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  /* ----- load staff + login accounts ----- */
  const load = useCallback(async () => {
    setLoading(true)
    const [staff, profiles] = await Promise.all([
      supabase.from('non_teaching_staff').select('id, full_name, position, phone_number, email, is_active').order('full_name'),
      supabase.from('profiles').select('email, role, is_active'),
    ])
    if (staff.error) showToast('error', staff.error.message)
    setRows((staff.data ?? []) as StaffRow[])

    const map = new Map<string, LoginProfile>()
    for (const p of (profiles.data ?? []) as LoginProfile[]) {
      if (p.email) map.set(p.email.trim().toLowerCase(), p)
    }
    setLogins(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* ----- derived ----- */
  const loginOf = (r: StaffRow) => (r.email ? logins.get(r.email.trim().toLowerCase()) ?? null : null)

  const positions = useMemo(() => [...new Set(rows.map((r) => r.position))].sort(), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => (positionFilter === 'all' ? true : r.position === positionFilter))
      .filter((r) => (statusFilter === 'all' ? true : statusFilter === 'active' ? r.is_active : !r.is_active))
      .filter(
        (r) =>
          !q ||
          r.full_name.toLowerCase().includes(q) ||
          r.position.toLowerCase().includes(q) ||
          (r.phone_number ?? '').toLowerCase().includes(q) ||
          (r.email ?? '').toLowerCase().includes(q),
      )
  }, [rows, search, positionFilter, statusFilter])

  const activeCount = rows.filter((r) => r.is_active).length
  const withLogin = rows.filter((r) => loginOf(r)).length

  /* ----- add / edit ----- */
  function openAdd() {
    setFullName('')
    setPosition('')
    setPhone('')
    setEmail('')
    setIsActive(true)
    setFormError(null)
    setModal({ mode: 'add' })
  }

  function openEdit(row: StaffRow) {
    setFullName(row.full_name)
    setPosition(row.position)
    setPhone(row.phone_number ?? '')
    setEmail(row.email ?? '')
    setIsActive(row.is_active)
    setFormError(null)
    setModal({ mode: 'edit', row })
  }

  async function saveForm() {
    const name = fullName.trim()
    const pos = position.trim()
    const mail = email.trim()
    if (!name) return setFormError('Enter the full name')
    if (!pos) return setFormError('Enter or choose a position')
    if (mail && !EMAIL_RE.test(mail)) return setFormError('Enter a valid email address')

    const payload = {
      full_name: name,
      position: pos,
      phone_number: phone.trim() || null,
      email: mail || null,
      is_active: isActive,
    }

    setSaving(true)
    const { error } =
      modal?.mode === 'edit'
        ? await supabase.from('non_teaching_staff').update(payload).eq('id', modal.row.id)
        : await supabase.from('non_teaching_staff').insert(payload)
    setSaving(false)

    if (error) {
      return setFormError(error.code === '23505' ? 'A staff member with that email already exists' : error.message)
    }
    showToast('ok', modal?.mode === 'edit' ? 'Staff member updated' : `${name} added`)
    setModal(null)
    await load()
  }

  async function confirmDelete() {
    if (!toDelete) return
    setSaving(true)
    const { error } = await supabase.from('non_teaching_staff').delete().eq('id', toDelete.id)
    setSaving(false)
    if (error) showToast('error', error.message)
    else {
      showToast('ok', 'Staff member removed')
      await load()
    }
    setToDelete(null)
  }

  /* ----- CSV ----- */
  function downloadCSV() {
    const header = ['Full name', 'Position', 'Phone', 'Email', 'Status']
    const body = rows.map((r) => [
      r.full_name,
      r.position,
      r.phone_number ?? '',
      r.email ?? '',
      r.is_active ? 'Active' : 'Inactive',
    ])
    const csv = [header, ...body].map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'non-teaching-staff.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function onUploadCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setSaving(true)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: async (result) => {
        const seen = new Set(rows.map((r) => (r.email ?? '').toLowerCase()).filter(Boolean))
        const toInsert: Omit<StaffRow, 'id'>[] = []
        let skipped = 0

        for (const row of result.data) {
          const name = (row['full name'] || row['name'] || '').trim()
          const pos = (row['position'] || row['job title'] || row['role'] || '').trim()
          const mail = (row['email'] || '').trim()
          const key = mail.toLowerCase()
          if (!name || !pos || (mail && !EMAIL_RE.test(mail)) || (key && seen.has(key))) {
            skipped++
            continue
          }
          if (key) seen.add(key)
          toInsert.push({
            full_name: name,
            position: pos,
            phone_number: (row['phone'] || row['phone number'] || '').trim() || null,
            email: mail || null,
            is_active: !/^(inactive|no|false)$/i.test((row['status'] || '').trim()),
          })
        }

        let failure: string | null = null
        if (toInsert.length > 0) {
          const { error } = await supabase.from('non_teaching_staff').insert(toInsert)
          if (error) failure = error.message
        }
        setSaving(false)

        if (failure) return showToast('error', failure)
        showToast('ok', `${toInsert.length} added${skipped ? `, ${skipped} skipped` : ''}`)
        await load()
      },
      error: () => {
        setSaving(false)
        showToast('error', 'Could not read that CSV file.')
      },
    })
  }

  /* ---------- render ---------- */
  const stats = [
    { label: 'Total staff', value: rows.length, icon: UserCog, chip: 'bg-royal-50 text-royal-600' },
    { label: 'Active', value: activeCount, icon: UserCheck, chip: 'bg-green-50 text-green-600' },
    { label: 'Inactive', value: rows.length - activeCount, icon: UserX, chip: 'bg-red-50 text-red-600' },
    { label: 'With a login', value: withLogin, icon: KeyRound, chip: 'bg-gold-400/20 text-gold-500' },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-royal-900">Non-teaching staff</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bursar, headteacher, director, store-keeper and everyone else who isn&apos;t a class or subject teacher.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-3 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50"
          >
            <Upload className="h-4 w-4" />
            Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={onUploadCSV} className="hidden" />
          <button
            onClick={downloadCSV}
            disabled={rows.length === 0}
            className="flex items-center gap-2 rounded-lg border border-royal-200 bg-white px-3 py-2 text-sm font-semibold text-royal-700 transition hover:bg-royal-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-royal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" />
            Add Staff
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, chip }) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`rounded-xl p-2.5 ${chip}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="text-xl font-bold text-royal-900">{loading ? '…' : value}</p>
              </div>
            </div>
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
            placeholder="Search name, position, phone or email"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} className={`${inputClass} w-44`}>
          <option value="all">All positions</option>
          {positions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className={`${inputClass} w-36`}
        >
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">SN</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Position</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">Login</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  {rows.length === 0 ? (
                    <>
                      No non-teaching staff yet. Click <b>Add Staff</b> to add the first one.
                    </>
                  ) : (
                    'No staff match your search.'
                  )}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => {
                const login = loginOf(r)
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-royal-50/60">
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-royal-900">{r.full_name}</p>
                      {r.email && <p className="text-xs text-gray-500">{r.email}</p>}
                    </td>
                    <td className="px-4 py-3">{r.position}</td>
                    <td className="px-4 py-3 text-gray-600">{r.phone_number || '—'}</td>
                    <td className="px-4 py-3">
                      {login ? (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            login.is_active ? 'bg-royal-50 text-royal-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {ROLE_LABEL[login.role] ?? login.role}
                          {!login.is_active && ' (off)'}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          r.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {!login && (
                          <button
                            onClick={() => setLoginFor(r)}
                            aria-label="Create login"
                            title="Create login"
                            className="rounded-md p-2 text-gold-500 transition hover:bg-gold-400/20"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                        )}
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
      <p className="mt-2 text-xs text-gray-500">
        The Login column shows when a staff member&apos;s email matches an account that can sign in to the hub.
      </p>

      {/* Add / edit */}
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add non-teaching staff' : 'Edit staff member'} onClose={() => setModal(null)}>
          <label className="block text-sm font-medium text-royal-900">Full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${inputClass} mt-1`} autoFocus />

          <label className="mt-4 block text-sm font-medium text-royal-900">Position</label>
          <input
            list="staff-position-suggestions"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="e.g. Bursar, or type your own"
            className={`${inputClass} mt-1`}
          />
          <datalist id="staff-position-suggestions">
            {POSITION_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>

          <label className="mt-4 block text-sm font-medium text-royal-900">
            Phone <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${inputClass} mt-1`}
          />

          <label className="mt-4 block text-sm font-medium text-royal-900">
            Email <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@school.edu"
            className={`${inputClass} mt-1`}
          />
          <p className="mt-1 text-xs text-gray-500">Use the same email as their hub login, if they have one, to link them.</p>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 accent-royal-600"
            />
            Currently working at the school
          </label>

          {formError && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
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

      {/* Delete */}
      {toDelete && (
        <Modal title="Remove this staff member?" onClose={() => setToDelete(null)}>
          <p className="text-sm text-gray-600">
            {toDelete.full_name} ({toDelete.position}) will be removed from this list. This doesn&apos;t delete any login
            account. To keep their record but stop counting them, edit them and untick &quot;Currently working&quot;
            instead.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setToDelete(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}

      {loginFor && (
        <CreateLoginModal
          row={loginFor}
          onClose={() => setLoginFor(null)}
          onDone={(m) => {
            setLoginFor(null)
            showToast('ok', m)
            void load()
          }}
        />
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