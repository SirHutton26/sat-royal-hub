import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Send, Trash2, Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Alert {
  id: string
  title: string
  message: string
  created_at: string
}

const alertSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  message: z.string().trim().min(1, 'Message is required'),
})
type AlertValues = z.infer<typeof alertSchema>

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AlertValues>({ resolver: zodResolver(alertSchema) })

  async function loadAlerts() {
    setLoading(true)
    const { data } = await supabase
      .from('alerts')
      .select('id, title, message, created_at')
      .order('created_at', { ascending: false })
    setAlerts(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  async function onSubmit(values: AlertValues) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('alerts').insert({
      title: values.title.trim(),
      message: values.message.trim(),
      created_by: user?.id,
    })
    if (!error) {
      reset()
      loadAlerts()
    }
  }

  async function deleteAlert(id: string) {
    if (!confirm('Delete this alert?')) return
    setDeletingId(id)
    const { error } = await supabase.from('alerts').delete().eq('id', id)
    if (!error) setAlerts((prev) => prev.filter((a) => a.id !== id))
    setDeletingId(null)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-royal-900">Alerts</h1>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="mt-4 space-y-3 rounded-xl bg-white p-4 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium text-royal-900">Title</label>
          <input
            {...register('title')}
            placeholder="e.g. Staff meeting tomorrow"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
          {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-royal-900">Message</label>
          <textarea
            rows={3}
            {...register('message')}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
          />
          {errors.message && <p className="mt-1 text-xs text-red-600">{errors.message.message}</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 rounded-md bg-royal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {isSubmitting ? 'Sending...' : 'Send to all teachers'}
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-gray-400">No alerts sent yet.</p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" />
                <div>
                  <p className="text-sm font-semibold text-royal-900">{a.title}</p>
                  <p className="mt-0.5 text-sm text-gray-600">{a.message}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => deleteAlert(a.id)}
                disabled={deletingId === a.id}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}