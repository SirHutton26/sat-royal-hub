import { useEffect, useState } from 'react'
import { QrCode, Printer, RefreshCw, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { QRCodeSVG } from 'qrcode.react'
import { renderToStaticMarkup } from 'react-dom/server'
import { STAFF_WINDOWS, accraMinutesNow, lastWeekday, localISO, staffStatusClass, staffStatusLabel } from '@/lib/attendance'
import schoolLogo from '@/assets/school-logo.png'

interface Teacher {
  id: string
  full_name: string | null
  email: string | null
  role: string
}

interface Record {
  teacher_id: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

export default function AdminStaffAttendance() {
  const [date, setDate] = useState(lastWeekday())
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrToken, setQrToken] = useState('')

  useEffect(() => {
    supabase.from('staff_qr_secret').select('token').eq('id', 1).maybeSingle().then(({ data }) => setQrToken(data?.token ?? ''))
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [teachersRes, recordsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role').in('role', ['teacher', 'bursar']).eq('is_active', true).order('full_name'),
        supabase.from('staff_attendance').select('teacher_id, clock_in_at, clock_out_at, status').eq('date', date),
      ])
      if (!active) return
      setTeachers(teachersRes.data ?? [])
      setRecords(recordsRes.data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [date])

  const byTeacher = new Map(records.map((r) => [r.teacher_id, r]))
  const isToday = date === localISO()
  // After 12:00 noon (Ghana) anyone without a check-in is Absent; earlier today they simply haven't come yet
  const absentNow = !isToday || accraMinutesNow() > STAFF_WINDOWS.veryLateEnd
  const presentCount = records.filter((r) => r.status !== 'Late' && r.status !== 'Very Late').length
  const lateCount = records.filter((r) => r.status === 'Late').length
  const veryLateCount = records.filter((r) => r.status === 'Very Late').length
  const absentCount = absentNow ? Math.max(0, teachers.filter((t) => !byTeacher.has(t.id)).length) : 0

  async function regenerateQr() {
    if (!confirm('Create a new QR code? Every printed copy of the old one will stop working.')) return
    const next = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase.from('staff_qr_secret').upsert({ id: 1, token: next })
    if (error) return alert(error.message)
    setQrToken(next)
    alert('New QR code created. Print it and replace the old one.')
  }

  const handlePrintQR = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <head>
          <title>SAT Royal Basic School - Staff Attendance QR Code</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 40px; }
            img { width: 100px; height: 100px; object-contain; margin-bottom: 20px; }
            h1 { color: #1e3a8a; font-size: 28px; margin-bottom: 5px; }
            h2 { color: #4b5563; font-size: 18px; margin-top: 0; }
            .qr-box { margin: 40px auto; padding: 30px; border: 4px solid #1e3a8a; display: inline-block; border-radius: 20px; }
            .instructions { font-size: 16px; color: #374151; max-width: 400px; margin: 20px auto; line-height: 1.5; }
          </style>
        </head>
        <body>
          <img src="${schoolLogo}" alt="Logo" />
          <h1>SAT ROYAL BASIC SCHOOL</h1>
          <h2>Official Staff Campus Check-In QR Code</h2>
          <div class="qr-box">
            ${renderToStaticMarkup(<QRCodeSVG value={qrToken} size={250} />)}
          </div>
          <p class="instructions">Open the <b>SAT Royal Hub PWA</b> on your mobile phone, click <b>Scan Campus QR Code</b>, and point your camera here to record your arrival on campus.</p>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 500)
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-royal-900">Staff Attendance Management</h1>
        <input
          type="date"
          value={date}
          max={localISO()}
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            // Attendance is only taken Monday to Friday; snap weekend picks back to Friday
            setDate(lastWeekday(v))
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />6:00 - 7:15 Present</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-500" />7:16 - 9:15 Present but late</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />9:16 - 12:00 Present but extremely late</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-gray-800" />After 12:00 Absent</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-royal-50 text-royal-600">
              <QrCode className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Campus QR Code</h2>
              <p className="mt-0.5 text-xs text-gray-500">Generate and print A4 attendance sheet for campus check-in.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowQRModal(true)}
              className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-semibold text-royal-700 transition hover:bg-gray-50"
            >
              View
            </button>
            <button
              onClick={handlePrintQR}
              className="flex items-center gap-1.5 rounded-xl bg-royal-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-royal-700"
            >
              <Printer className="h-3.5 w-3.5" /> Print A4
            </button>
            <button
              onClick={regenerateQr}
              title="Create a new QR code"
              aria-label="New QR code"
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-700">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-royal-900">Attendance Summary</h2>
              <p className="mt-0.5 text-xs text-gray-500">{date === localISO() ? "Today's live stats" : `Stats for ${date}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-sm font-bold text-green-600">{presentCount}</p>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Present</p>
            </div>
            <div className="border-l border-gray-200 pl-3">
              <p className="text-sm font-bold text-orange-500">{lateCount}</p>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Late</p>
            </div>
            <div className="border-l border-gray-200 pl-3">
              <p className="text-sm font-bold text-red-600">{veryLateCount}</p>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Very late</p>
            </div>
            <div className="border-l border-gray-200 pl-3">
              <p className="text-sm font-bold text-gray-800">{absentCount}</p>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Absent</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Staff Name</th>
              <th className="px-4 py-3">Check-In</th>
              <th className="px-4 py-3">Sign-Out</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">Loading attendance records...</td>
              </tr>
            ) : teachers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">No active staff found.</td>
              </tr>
            ) : (
              teachers.map((t) => {
                const r = byTeacher.get(t.id)
                return (
                  <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-royal-50/30">
                    <td className="px-4 py-3 font-medium text-royal-900">
                      {t.full_name || t.email}
                      {t.role === 'bursar' && <span className="ml-2 text-xs font-normal text-gray-400">Bursar</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r?.clock_in_at ? new Date(r.clock_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r?.clock_out_at ? new Date(r.clock_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {!r ? (
                        absentNow ? (
                          <span className="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-1 text-xs font-semibold text-white">Absent</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Not clocked in yet</span>
                        )
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${staffStatusClass(r.status)}`}>
                          {staffStatusLabel(r.status)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showQRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            <img src={schoolLogo} alt="Logo" className="mx-auto h-14 w-14 object-contain" />
            <h3 className="mt-3 text-lg font-bold text-royal-900">Campus Check-In QR Code</h3>
            <p className="mt-1 text-xs text-gray-500">Display this code physically on campus for teachers to scan.</p>
            
            <div className="my-6 inline-block rounded-2xl border-2 border-royal-100 bg-gray-50 p-4">
              {qrToken ? <QRCodeSVG value={qrToken} size={192} className="mx-auto" /> : <p className="text-xs text-gray-500">No QR code yet. Press the refresh button to create one.</p>}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowQRModal(false)}
                className="w-1/2 rounded-xl border border-gray-200 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowQRModal(false)
                  handlePrintQR()
                }}
                className="w-1/2 rounded-xl bg-royal-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-royal-700"
              >
                Print A4
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}