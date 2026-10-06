import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Row {
  id: string
  sender_name: string | null
  audience: string
  message: string
  total: number
  sent: number
  failed: number
  created_at: string
}

export default function MessengerHistory() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    supabase
      .from('sms_broadcasts')
      .select('id, sender_name, audience, message, total, sent, failed, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows((data as Row[]) ?? []))
  }, [])

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-royal-900">History</h1>
      <p className="mt-1 text-sm text-gray-500">Messages sent from this portal.</p>
      {!rows ? (
        <Loader2 className="mt-6 h-5 w-5 animate-spin text-royal-700" />
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">Nothing sent yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                <span className="font-semibold text-royal-800">{r.audience}</span>
                <span>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-800">{r.message}</p>
              <p className="mt-2 text-xs">
                <span className="text-green-700">{r.sent} sent</span>
                {r.failed > 0 && <span className="ml-2 text-red-600">{r.failed} failed</span>}
                <span className="ml-2 text-gray-400">of {r.total}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
