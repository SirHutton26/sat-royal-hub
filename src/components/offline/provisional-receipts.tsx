import { useCallback, useEffect, useState } from 'react'
import { db, OUTBOX_EVENT, type ReceiptMapRow } from '@/lib/offline-db'
import { useAuth } from '@/features/auth/AuthProvider'

/** Shows which provisional (OFF-) receipts received their real numbers after syncing */
export default function ProvisionalReceipts() {
  const { session } = useAuth()
  const [rows, setRows] = useState<ReceiptMapRow[]>([])
  const uid = session?.user.id

  const load = useCallback(async () => {
    if (uid) setRows(await db.receipts.where('userId').equals(uid).toArray())
  }, [uid])

  useEffect(() => {
    void load()
    window.addEventListener(OUTBOX_EVENT, load)
    return () => window.removeEventListener(OUTBOX_EVENT, load)
  }, [load])

  if (!rows.length) return null
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold text-amber-900">Offline payments now have official receipt numbers</p>
      <p className="mt-1 text-amber-800">Write the official number on the provisional paper receipt, or reprint it below.</p>
      <ul className="mt-2 space-y-0.5 font-mono text-xs text-amber-900">
        {rows.map((r) => (
          <li key={r.tempNo}>
            {r.tempNo} → {r.receiptNo}
          </li>
        ))}
      </ul>
      <button
        onClick={async () => {
          await db.receipts.where('userId').equals(uid!).delete()
          void load()
        }}
        className="mt-3 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white"
      >
        Done, clear this list
      </button>
    </div>
  )
}
