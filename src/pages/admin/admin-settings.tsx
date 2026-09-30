import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Clock, Save, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function AdminSettings() {
  const [cutoff, setCutoff] = useState('07:30')
  const [qrToken, setQrToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('school_settings').select('*').eq('id', 1).single()
    if (data) {
      setCutoff(data.clock_in_cutoff?.slice(0, 5) ?? '07:30')
      setQrToken(data.staff_qr_token ?? '')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function saveCutoff() {
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('school_settings').update({ clock_in_cutoff: `${cutoff}:00` }).eq('id', 1)
    setSaving(false)
    setMessage(error ? error.message : 'Cutoff time saved.')
  }

  async function regenerateQr() {
    if (!confirm('Generate a new QR code? Any printed copies of the old one will stop working.')) return
    setRegenerating(true)
    const newToken = crypto.randomUUID()
    const { error } = await supabase.from('school_settings').update({ staff_qr_token: newToken }).eq('id', 1)
    setRegenerating(false)
    if (!error) {
      setQrToken(newToken)
      setMessage('New QR code generated — print and display the new one.')
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Controls for staff clock-in.</p>

      <div className="mt-6 max-w-md space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-royal-900">
            <Clock className="h-4 w-4" />
            Clock-in cutoff time
          </label>
          <input
            type="time"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
          <p className="mt-1 text-xs text-gray-400">Teachers clocking in after this time are marked Late.</p>
        </div>

        <button
          onClick={saveCutoff}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save cutoff time'}
        </button>

        {message && <p className="text-sm text-gray-500">{message}</p>}
      </div>

      <div className="mt-6 max-w-md rounded-xl bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-royal-900">Staff attendance QR code</p>
        <p className="mt-1 text-xs text-gray-500">
          Print this and place it at the school entrance. Teachers scan it to clock in and out.
        </p>
        <div className="mt-4 flex justify-center">
          <div className="rounded-xl border border-gray-200 p-4">
            <QRCodeSVG value={qrToken} size={200} />
          </div>
        </div>
        <button
          onClick={regenerateQr}
          disabled={regenerating}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-royal-50 px-3 py-2 text-sm font-medium text-royal-700 transition hover:bg-royal-100 disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" />
          {regenerating ? 'Generating...' : 'Regenerate code'}
        </button>
      </div>
    </div>
  )
}