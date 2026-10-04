export type Method = 'cash' | 'mobile_money' | 'bank'

export const METHOD_LABEL: Record<Method, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank: 'Bank',
}

export const money = (n: number) =>
  'GH₵ ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Everything the receipt needs to show; built by Record Payment and by the Receipts page */
export interface Receipt {
  receiptNo: string
  paidAt: string
  amount: number
  method: Method
  reference: string | null
  item: string
  term: string
  year: string
  studentName: string
  admissionNo: string
  className: string
  balanceAfter: number
  receivedBy: string
  status: 'valid' | 'void'
  voidReason?: string | null
}

// The students table is read with select('*'), so these helpers cope with
// different column names for the student's name and admission number.
export function studentName(s: Record<string, unknown>) {
  const direct = s.full_name ?? s.name
  if (direct) return String(direct)
  const joined = [s.first_name, s.middle_name, s.other_names, s.last_name].filter(Boolean).join(' ')
  return joined || 'Unnamed student'
}

export function admissionNo(s: Record<string, unknown>) {
  return String(s.admission_number ?? s.admission_no ?? s.admission_id ?? '')
}
