import { useRef } from 'react'
import { Printer, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import schoolLogo from '@/assets/school-logo.png'
import { METHOD_LABEL, money, type Receipt } from '@/components/fees/fee-utils'

export default function ReceiptModal({
  receipt,
  onClose,
  sendSms = false,
  onSmsResult,
}: {
  receipt: Receipt
  onClose: () => void
  /** Text the guardian when the bursar prints or closes the receipt (new payments only, not reprints) */
  sendSms?: boolean
  onSmsResult?: (result: { ok: boolean; message: string }) => void
}) {
  const isVoid = receipt.status === 'void'
  const smsStarted = useRef(false)

  // Fires once per receipt, whether the bursar clicks Print or Done first.
  // The edge function looks up the guardian's number and builds the message itself.
  function notifyGuardian() {
    if (!sendSms || isVoid || smsStarted.current) return
    smsStarted.current = true
    void supabase.functions
      .invoke('send-receipt-sms', { body: { receipt_no: receipt.receiptNo } })
      .then(({ data, error }) => {
        if (error) return onSmsResult?.({ ok: false, message: 'SMS could not be sent' })
        if (data?.sent) return onSmsResult?.({ ok: true, message: 'SMS sent to guardian' })
        onSmsResult?.({ ok: false, message: data?.reason ?? 'SMS not sent' })
      })
  }

  const lines: [string, string][] = [
    ['Receipt no.', receipt.receiptNo],
    ['Date', new Date(receipt.paidAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Student', receipt.studentName],
    ['Admission no.', receipt.admissionNo || '—'],
    ['Class', receipt.className || '—'],
    ['Fee item', `${receipt.item} (${receipt.term}, ${receipt.year})`],
    ['Method', METHOD_LABEL[receipt.method]],
  ]
  if (receipt.reference) lines.push(['Reference', receipt.reference])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-royal-900/50 px-4 py-6">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .receipt-print, .receipt-print * { visibility: visible !important; }
          .receipt-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
        }
      `}</style>

      <div className="w-full max-w-sm">
        <div className="receipt-print relative overflow-hidden rounded-2xl bg-white p-6 shadow-xl">
          {isVoid && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="-rotate-12 rounded-lg border-4 border-red-500/60 px-4 py-1 text-5xl font-black tracking-widest text-red-500/40">
                VOID
              </span>
            </div>
          )}

          <div className="flex flex-col items-center text-center">
            <img src={schoolLogo} alt="" className="h-14 w-14 object-contain" />
            <p className="mt-2 text-base font-bold text-royal-900">SAT ROYAL BASIC SCHOOL</p>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Fee Receipt</p>
          </div>

          <div className="my-4 h-px bg-gray-200" />

          <dl className="space-y-2 text-sm">
            {lines.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right font-medium text-royal-900">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="my-4 h-px bg-gray-200" />

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-royal-900">Amount paid</span>
            <span className={`text-xl font-bold ${isVoid ? 'text-gray-400 line-through' : 'text-royal-900'}`}>
              {money(receipt.amount)}
            </span>
          </div>
          {!isVoid && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-gray-500">Balance remaining</span>
              <span className="font-semibold text-royal-900">{money(receipt.balanceAfter)}</span>
            </div>
          )}

          {isVoid && receipt.voidReason && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              Voided: {receipt.voidReason}
            </p>
          )}

          <p className="mt-5 text-center text-xs text-gray-500">Received by {receipt.receivedBy}</p>
          {!isVoid && <p className="mt-1 text-center text-[11px] text-gray-400">Thank you for your payment</p>}
        </div>

        <div className="mt-3 flex gap-2 print:hidden">
          <button
            onClick={() => {
              notifyGuardian()
              window.print()
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-royal-700 shadow hover:bg-royal-50"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            onClick={() => {
              notifyGuardian()
              onClose()
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-royal-600 py-3 text-sm font-semibold text-white shadow hover:bg-royal-700"
          >
            <X className="h-4 w-4" />
            Done
          </button>
        </div>
      </div>
    </div>
  )
}