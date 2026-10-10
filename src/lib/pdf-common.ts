import { jsPDF } from 'jspdf'

export const SCHOOL = {
  name: 'SAT Royal Basic School',
  place: 'KASSEH-ADA',
  tel: 'TEL: 0244 917 290 / 0243 075 601 / 0244 468 134',
}

export async function imageToDataUrl(src: string): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c.toDataURL('image/png')
}

export function ordinal(n: number | null | undefined) {
  if (!n) return ''
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function words(n: number): string {
  if (n === 0) return 'Zero'
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + words(n % 100) : '')
  if (n < 1_000_000) return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + words(n % 1000) : '')
  return words(Math.floor(n / 1_000_000)) + ' Million' + (n % 1_000_000 ? ' ' + words(n % 1_000_000) : '')
}

/** 1250.5 -> "One Thousand Two Hundred and Fifty Ghana Cedis and Fifty Pesewas only" */
export function cedisInWords(amount: number) {
  const cedis = Math.floor(amount + 1e-9)
  const pesewas = Math.round((amount - cedis) * 100)
  let s = `${words(cedis)} Ghana Cedis`
  if (pesewas) s += ` and ${words(pesewas)} Pesewas`
  return s + ' only'
}

export const gh = (n: number) => 'GH¢ ' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Text that shrinks until it fits the width */
export function fitText(doc: jsPDF, text: string, x: number, y: number, maxW: number, size: number, min = 5.5, opts?: { align?: 'left' | 'center' | 'right' }) {
  let s = size
  doc.setFontSize(s)
  while (doc.getTextWidth(text) > maxW && s > min) {
    s -= 0.25
    doc.setFontSize(s)
  }
  doc.text(text, x, y, opts)
}

/** Dotted underline, like a filled-in paper form */
export function dotted(doc: jsPDF, x1: number, x2: number, y: number) {
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([0.3, 0.9], 0)
  doc.line(x1, y, x2, y)
  doc.setLineDashPattern([], 0)
}

export function dmy(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
