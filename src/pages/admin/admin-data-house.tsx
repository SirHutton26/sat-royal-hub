import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Database, Download, Loader2, RotateCcw, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface BackupFile {
  path: string
  name: string
  kind: string
  size: number
  created_at: string
}

const KIND_LABEL: Record<string, string> = { auto: 'Automatic (12 noon)', manual: 'Manual / safety copy', uploads: 'Uploaded by you' }
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function call<T>(body: object): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke('backup-data', { body })
  if (error) {
    let msg = error.message
    try {
      const j = await (error as unknown as { context: Response }).context.json()
      if (j?.error) msg = j.error
    } catch {
      /* keep generic message */
    }
    return { error: msg }
  }
  if (data?.error) return { error: data.error }
  return { data: data as T }
}

export default function AdminDataHouse() {
  const [files, setFiles] = useState<BackupFile[] | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restoreFor, setRestoreFor] = useState<BackupFile | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await call<{ files: BackupFile[] }>({ action: 'list' })
    if (r.error) setMsg({ ok: false, text: r.error })
    setFiles(r.data?.files ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function backupNow() {
    setBusy('backup')
    setMsg(null)
    const r = await call<{ tables: number; rows: number; errors: Record<string, string> }>({ action: 'run', kind: 'manual' })
    setBusy('')
    if (r.error) return setMsg({ ok: false, text: r.error })
    const bad = Object.keys(r.data!.errors)
    setMsg({ ok: true, text: `Backup saved: ${r.data!.rows} records from ${r.data!.tables} tables.${bad.length ? ` Skipped: ${bad.join(', ')}` : ''}` })
    void load()
  }

  async function download(f: BackupFile) {
    setBusy(f.path)
    const r = await call<{ url: string }>({ action: 'download', path: f.path })
    setBusy('')
    if (r.error) return setMsg({ ok: false, text: r.error })
    window.location.href = r.data!.url
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.endsWith('.json')) return setMsg({ ok: false, text: 'Choose a .json backup file' })
    setBusy('upload')
    setMsg(null)
    const path = `uploads/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const { error } = await supabase.storage.from('backups').upload(path, file, { contentType: 'application/json' })
    setBusy('')
    if (error) return setMsg({ ok: false, text: error.message })
    await load()
    setRestoreFor({ path, name: file.name, kind: 'uploads', size: file.size, created_at: new Date().toISOString() })
    setConfirmText('')
  }

  async function restore() {
    if (!restoreFor) return
    setBusy('restore')
    const r = await call<{ restored: Record<string, number>; failed: Record<string, string>; safety_backup: string }>({ action: 'restore', path: restoreFor.path })
    setBusy('')
    setRestoreFor(null)
    if (r.error) return setMsg({ ok: false, text: r.error })
    const n = Object.values(r.data!.restored).reduce((a, b) => a + b, 0)
    const bad = Object.entries(r.data!.failed)
    setMsg({
      ok: bad.length === 0,
      text: `Restored ${n} records. ${bad.length ? 'Problems: ' + bad.map(([t, m]) => `${t} (${m})`).join('; ') + '. ' : ''}A safety copy of the previous data was saved.`,
    })
    void load()
  }

  const latestAuto = files?.find((f) => f.kind === 'auto')

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-royal-900">Data House</h1>
      <p className="mt-1 text-sm text-gray-500">Backups of all school data, including the bursar's fees, payments and receipts.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="flex items-center gap-2 text-xs font-medium text-gray-500"><Clock className="h-4 w-4" /> Automatic backup</p>
          <p className="mt-1 font-semibold text-royal-900">Every day at 12:00 noon</p>
          <p className="mt-1 text-xs text-gray-500">{latestAuto ? `Last: ${new Date(latestAuto.created_at).toLocaleString()}` : 'No automatic backup yet'}</p>
        </div>
        <button onClick={backupNow} disabled={!!busy} className="flex items-center gap-3 rounded-2xl bg-royal-700 p-4 text-left text-white shadow-sm hover:bg-royal-800 disabled:opacity-60">
          {busy === 'backup' ? <Loader2 className="h-6 w-6 animate-spin" /> : <Database className="h-6 w-6" />}
          <span>
            <span className="block font-semibold">Back up now</span>
            <span className="block text-xs text-white/70">Save a copy right away</span>
          </span>
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-royal-200 hover:bg-royal-50 disabled:opacity-60">
          {busy === 'upload' ? <Loader2 className="h-6 w-6 animate-spin text-royal-700" /> : <Upload className="h-6 w-6 text-royal-700" />}
          <span>
            <span className="block font-semibold text-royal-900">Upload a backup</span>
            <span className="block text-xs text-gray-500">Restore from a file</span>
          </span>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onUpload} />
      </div>

      {msg && (
        <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
        </p>
      )}

      <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-royal-600 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Size</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {!files ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No backups yet. Press <b>Back up now</b>.</td></tr>
            ) : (
              files.map((f) => (
                <tr key={f.path} className="border-t border-gray-100">
                  <td className="px-4 py-3">{f.created_at ? new Date(f.created_at).toLocaleString() : f.name}</td>
                  <td className="px-4 py-3 text-gray-600">{KIND_LABEL[f.kind] ?? f.kind}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtSize(f.size)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => download(f)} disabled={!!busy} aria-label="Download" title="Download" className="rounded-md p-2 text-royal-600 hover:bg-royal-50 disabled:opacity-50">
                        {busy === f.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </button>
                      <button onClick={() => { setRestoreFor(f); setConfirmText('') }} disabled={!!busy} aria-label="Restore" title="Restore" className="rounded-md p-2 text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">The newest 30 backups of each type are kept. Login accounts (passwords) are not part of a backup.</p>

      {restoreFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-royal-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-royal-900">Restore this backup?</h2>
            <p className="mt-2 text-sm text-gray-600">
              <b>{restoreFor.name}</b> will be loaded into the system. Records in the backup replace the matching records now; nothing is deleted. A safety copy of the current data is saved first.
            </p>
            <p className="mt-3 text-sm text-gray-600">Type <b>RESTORE</b> to continue.</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRestoreFor(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={restore} disabled={confirmText !== 'RESTORE' || busy === 'restore'} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                {busy === 'restore' && <Loader2 className="h-4 w-4 animate-spin" />} Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
