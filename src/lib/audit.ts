import { supabase } from '@/lib/supabase'

// Actions the app is allowed to log. Payments and SMS results are logged by the database and the
// edge function, so they cannot be created from here.
export type ClientAuditAction =
  | 'receipt.viewed'
  | 'receipt.printed'
  | 'report.exported'
  | 'log.exported'
  | 'attendance.clock_in'
  | 'attendance.clock_out'

/** Fire and forget: logging never blocks the screen or breaks the action that triggered it. */
export function logAudit(
  action: ClientAuditAction,
  summary: string,
  entity?: { type?: string; id?: string },
  details?: Record<string, unknown>,
) {
  void supabase
    .rpc('log_audit', {
      p_action: action,
      p_entity_type: entity?.type ?? null,
      p_entity_id: entity?.id ?? null,
      p_summary: summary,
      p_details: details ?? {},
    })
    .then(({ error }) => {
      if (error) console.warn('Audit log failed:', error.message)
    })
}