import { jsPDF } from 'jspdf'
import { METHOD_LABEL, type Receipt } from '@/components/fees/fee-utils'
import { SCHOOL, cedisInWords, dmy, dotted, fitText, gh } from '@/lib/pdf-common'

const CELL_W = 105
const CELL_H = 99 // 3 rows x 99mm = A4

/** One official receipt (same wording as the school's receipt book), drawn inside a 105 x 99 mm cell */
function drawReceipt(doc: jsPDF, x: number, y: number, r: Receipt) {
  const pad = 5
  const ox = x + pad
  const iw = CELL_W - pad * 2
  const oy = y + pad
  const right = ox + iw
  doc.setTextColor(40, 40, 40)

  // Heading
  doc.setFont('helvetica', 'bold')
  fitText(doc, SCHOOL.name, x + CELL_W / 2, oy + 5, iw, 14, 9, { align: 'center' })
  doc.setFontSize(8)
  doc.text(SCHOOL.place, x + CELL_W / 2, oy + 9.5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  fitText(doc, SCHOOL.tel, x + CELL_W / 2, oy + 13, iw, 6.5, 5, { align: 'center' })
  doc.setLineWidth(0.9)
  doc.line(ox, oy + 15, right, oy + 15)
  doc.setLineWidth(0.3)
  doc.line(ox, oy + 16.3, right, oy + 16.3)

  // "Official Receipt" box and number
  doc.setFillColor(55, 55, 55)
  doc.roundedRect(ox, oy + 19, 38, 8, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('courier', 'bold')
  doc.setFontSize(10)
  doc.text('Official Receipt', ox + 19, oy + 24.3, { align: 'center' })
  doc.setTextColor(40, 40, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('No.', ox + 43, oy + 24.5)
  doc.setFont('courier', 'bold')
  fitText(doc, r.receiptNo, ox + 50, oy + 24.5, iw - 50, 9, 6)

  // A filled-in line:  label ........ value
  const field = (label: string, value: string, yy: number, x1 = ox, x2 = right, size = 8.5) => {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.text(label, x1, yy)
    const start = x1 + doc.getTextWidth(label) + 1
    dotted(doc, start, x2, yy + 0.9)
    doc.setFont('helvetica', 'bold')
    fitText(doc, value, start + 1, yy - 0.2, x2 - start - 1.5, size, 5.5)
  }

  field('Date:', dmy(r.paidAt), oy + 33, ox + 50, right)
  field('Received from:', `${r.studentName}${r.className ? ` (${r.className}${r.admissionNo ? `, ${r.admissionNo}` : ''})` : ''}`, oy + 40)
  field('The sum of:', cedisInWords(r.amount), oy + 47, ox, right, 8)

  // "........ Cedis ........ Pesewas"
  const cedis = Math.floor(r.amount + 1e-9)
  const pes = Math.round((r.amount - cedis) * 100)
  const lineY = oy + 54
  dotted(doc, ox, ox + 40, lineY + 0.9)
  dotted(doc, ox + 50, ox + 74, lineY + 0.9)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(cedis.toLocaleString('en-GB'), ox + 20, lineY - 0.2, { align: 'center' })
  doc.text(String(pes).padStart(2, '0'), ox + 62, lineY - 0.2, { align: 'center' })
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('Cedis', ox + 41.5, lineY)
  doc.text('Pesewas', ox + 75.5, lineY)

  field('Being:', `${r.item}${r.term ? ` - ${r.term}` : ''}${r.year ? ` ${r.year}` : ''}`, oy + 61)
  dotted(doc, ox, right, oy + 68)

  field('Cash/Cheque No:', `${METHOD_LABEL[r.method]}${r.reference ? ` / ${r.reference}` : ''}`, oy + 76, ox, ox + 52, 7.5)
  field('Balance:', gh(Math.max(0, r.balanceAfter)), oy + 76, ox + 56, right)

  // Amount box
  doc.setLineWidth(0.5)
  doc.rect(ox, oy + 79, 42, 9.5)
  doc.setFont('helvetica', 'bold')
  fitText(doc, gh(r.amount), ox + 21, oy + 85.5, 38, 12, 8, { align: 'center' })

  // Signature
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.text(`Received by: ${r.receivedBy}`, right, oy + 82.5, { align: 'right' })
  dotted(doc, ox + 50, right, oy + 86)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7)
  doc.text('Signature', ox + 50 + (iw - 50) / 2, oy + 89, { align: 'center' })
}

/** 6 receipts per A4 sheet (2 across, 3 down) with cutting guides */
export function buildReceiptSheetPdf(receipts: Receipt[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  receipts.forEach((r, i) => {
    const slot = i % 6
    if (i > 0 && slot === 0) doc.addPage()
    if (slot === 0) {
      // cutting guides for this sheet
      doc.setDrawColor(150)
      doc.setLineWidth(0.15)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(CELL_W, 0, CELL_W, 297)
      doc.line(0, CELL_H, 210, CELL_H)
      doc.line(0, CELL_H * 2, 210, CELL_H * 2)
      doc.setLineDashPattern([], 0)
      doc.setDrawColor(40)
    }
    drawReceipt(doc, (slot % 2) * CELL_W, Math.floor(slot / 2) * CELL_H, r)
  })
  doc.save(`receipts-${new Date().toISOString().slice(0, 10)}.pdf`)
}
