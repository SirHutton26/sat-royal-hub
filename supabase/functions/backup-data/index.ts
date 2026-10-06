// Daily/manual backups of the hub's data to private storage, plus restore.
// Secrets: BACKUP_SECRET (for the daily scheduler)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-secret',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const BUCKET = 'backups'
const KEEP = 30
// Everything worth keeping (bursar data included). profiles is saved for reference only.
const BACKUP_TABLES = [
  'school_settings', 'profiles', 'classes', 'subjects', 'students', 'subject_assignments', 'non_teaching_staff',
  'fee_structures', 'fee_payments', 'fee_payment_sms', 'daily_fee_rates', 'daily_collections', 'daily_feeding',
  'weekly_class_fee_remittances', 'attendance', 'staff_attendance', 'grades', 'exam_sessions', 'exam_scores',
  'score_bank_entries', 'score_bank_scores', 'sba_configs', 'sba_results', 'alerts', 'audit_logs', 'sms_broadcasts', 'activity_log',
]
// Restore order (parents before children). profiles/logs are never overwritten.
const RESTORE_ORDER = BACKUP_TABLES.filter((t) => !['profiles', 'audit_logs', 'sms_broadcasts', 'activity_log'].includes(t))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Caller: the scheduler (secret) or a signed-in admin
    const secret = Deno.env.get('BACKUP_SECRET')
    const viaCron = !!secret && req.headers.get('x-backup-secret') === secret
    if (!viaCron) {
      const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
      const { data: auth } = await admin.auth.getUser(token)
      if (!auth.user) return json({ error: 'Not signed in' }, 401)
      const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', auth.user.id).maybeSingle()
      if (!me?.is_active || me.role !== 'admin') return json({ error: 'Not allowed' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? 'run')

    async function fetchAll(table: string) {
      const rows: unknown[] = []
      for (let o = 0; ; o += 1000) {
        let { data, error } = await admin.from(table).select('*').order('id').range(o, o + 999)
        if (error) ({ data, error } = await admin.from(table).select('*').range(o, o + 999))
        if (error) throw new Error(error.message)
        rows.push(...(data ?? []))
        if ((data?.length ?? 0) < 1000) break
      }
      return rows
    }

    async function runBackup(kind: 'auto' | 'manual') {
      const tables: Record<string, unknown[]> = {}
      const counts: Record<string, number> = {}
      const errors: Record<string, string> = {}
      for (const t of BACKUP_TABLES) {
        try {
          tables[t] = await fetchAll(t)
          counts[t] = tables[t].length
        } catch (e) {
          errors[t] = e instanceof Error ? e.message : 'failed'
        }
      }
      const now = new Date()
      const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '')
      const path = `${kind}/backup-${stamp}.json`
      const file = JSON.stringify({ format: 'sat-hub-backup', version: 1, created_at: now.toISOString(), counts, errors, tables })
      const { error } = await admin.storage.from(BUCKET).upload(path, new Blob([file], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
      if (error) throw new Error(error.message)
      // keep only the newest KEEP files in this folder
      const { data: all } = await admin.storage.from(BUCKET).list(kind, { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
      const old = (all ?? []).slice(KEEP).map((f) => `${kind}/${f.name}`)
      if (old.length) await admin.storage.from(BUCKET).remove(old)
      return { path, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), errors }
    }

    if (action === 'run') return json(await runBackup(body.kind === 'auto' ? 'auto' : 'manual'))

    if (action === 'list') {
      const out: { path: string; name: string; kind: string; size: number; created_at: string }[] = []
      for (const kind of ['auto', 'manual', 'uploads']) {
        const { data } = await admin.storage.from(BUCKET).list(kind, { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
        for (const f of data ?? []) {
          if (!f.name || f.id === null) continue
          out.push({ path: `${kind}/${f.name}`, name: f.name, kind, size: Number((f.metadata as { size?: number } | null)?.size ?? 0), created_at: f.created_at ?? '' })
        }
      }
      out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return json({ files: out })
    }

    if (action === 'download') {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(String(body.path), 120, { download: String(body.path).split('/').pop() })
      if (error) return json({ error: error.message }, 400)
      return json({ url: data.signedUrl })
    }

    if (action === 'restore') {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(String(body.path))
      if (error || !blob) return json({ error: error?.message ?? 'File not found' }, 400)
      let parsed: { format?: string; tables?: Record<string, Record<string, unknown>[]> }
      try {
        parsed = JSON.parse(await blob.text())
      } catch {
        return json({ error: 'That file is not a valid backup' }, 400)
      }
      if (parsed.format !== 'sat-hub-backup' || !parsed.tables) return json({ error: 'That file is not a hub backup' }, 400)

      const safety = await runBackup('manual') // always keep a copy of the current data first
      const restored: Record<string, number> = {}
      const failed: Record<string, string> = {}
      for (const t of RESTORE_ORDER) {
        const rows = parsed.tables[t]
        if (!rows?.length) continue
        for (let i = 0; i < rows.length; i += 300) {
          const { error: e } = await admin.from(t).upsert(rows.slice(i, i + 300))
          if (e) {
            failed[t] = e.message
            break
          }
          restored[t] = (restored[t] ?? 0) + Math.min(300, rows.length - i)
        }
      }
      return json({ restored, failed, safety_backup: safety.path })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
