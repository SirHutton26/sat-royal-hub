import { jsPDF } from 'jspdf'
import schoolLogo from '@/assets/school-logo.png'
import type { Card } from '@/lib/report-card'
import { SCHOOL, dmy, dotted, fitText, gh, imageToDataUrl, ordinal } from '@/lib/pdf-common'

interface Opts {
  className: string
  term: string
  year: string
  date: string
  rollCount: number
  jhs9?: boolean
}

const M = 12 // page margin (mm)
const W = 210 - M * 2

const COLS: { label: string; sub: string; w: number; align: 'left' | 'center' }[] = [
  { label: 'SUBJECT', sub: '', w: 52, align: 'left' },
  { label: 'CLASS SCORE', sub: '(50%)', w: 20, align: 'center' },
  { label: 'EXAM SCORE', sub: '(50%)', w: 20, align: 'center' },
  { label: 'TOTAL SCORE', sub: '(100%)', w: 20, align: 'center' },
  { label: 'POSITION IN CLASS', sub: '', w: 22, align: 'center' },
  { label: 'GRADE', sub: '', w: 14, align: 'center' },
  { label: 'REMARKS', sub: '', w: 38, align: 'left' },
]

const num = (n: number | null) => (n === null ? '' : String(Math.round(n * 10) / 10))

function drawCard(doc: jsPDF, c: Card, o: Opts, logo: string) {
  doc.setTextColor(30, 30, 30)

  // ---- Header
  doc.addImage(logo, 'PNG', M, M, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(SCHOOL.name.toUpperCase(), 105 + 8, M + 8, { align: 'center' })
  doc.setFontSize(9.5)
  doc.text(SCHOOL.place, 105 + 8, M + 13.5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(SCHOOL.tel, 105 + 8, M + 18, { align: 'center' })
  doc.setLineWidth(0.9)
  doc.line(M, M + 23, M + W, M + 23)
  doc.setLineWidth(0.3)
  doc.line(M, M + 24.4, M + W, M + 24.4)

  doc.setFillColor(40, 40, 40)
  doc.roundedRect(M + W / 2 - 38, M + 28, 76, 8, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text("STUDENT'S REPORT CARD", M + W / 2, M + 33.4, { align: 'center' })
  doc.setTextColor(30, 30, 30)

  // ---- Student details
  const info = (label: string, value: string, x: number, y: number, w: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(label, x, y)
    const sx = x + doc.getTextWidth(label) + 1.5
    dotted(doc, sx, x + w, y + 1)
    doc.setFont('helvetica', 'bold')
    fitText(doc, value, sx + 1, y - 0.3, x + w - sx - 1.5, 9.5, 6)
  }
  const y0 = M + 46
  info('NAME:', c.name, M, y0, W)
  info('TERM:', o.term, M, y0 + 7, 56)
  info('STAGE:', o.className, M + 62, y0 + 7, 56)
  info('YEAR:', o.year, M + 124, y0 + 7, W - 124)
  info('NO. ON ROLL:', String(o.rollCount), M, y0 + 14, 56)
  info('POSITION IN CLASS:', c.position ? `${ordinal(c.position)} of ${o.rollCount}` : '', M + 62, y0 + 14, 56 + 6 + 8)
  info('DATE:', o.date, M + 138, y0 + 14, W - 138)

  // ---- Results table
  let y = y0 + 21
  const headH = 11
  doc.setLineWidth(0.3)
  let x = M
  for (const col of COLS) {
    doc.setFillColor(235, 235, 235) // set again each time: drawing text changes the PDF's current fill colour
    doc.rect(x, y, col.w, headH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    const lines = doc.splitTextToSize(col.label, col.w - 2) as string[]
    const total = lines.length + (col.sub ? 1 : 0)
    let ty = y + headH / 2 - ((total - 1) * 2.6) / 2 + 0.8
    for (const ln of lines) {
      doc.text(ln, x + col.w / 2, ty, { align: 'center' })
      ty += 2.6
    }
    if (col.sub) doc.text(col.sub, x + col.w / 2, ty, { align: 'center' })
    x += col.w
  }
  y += headH

  const rows = c.subjects
  const maxBody = 117 // mm available for rows
  const rowH = Math.min(7.2, maxBody / Math.max(rows.length, 1))
  const bodySize = rowH < 5.5 ? 7 : 8
  rows.forEach((r) => {
    x = M
    const cells = [r.subject.toUpperCase(), num(r.classScore), num(r.examScore), num(r.total), r.position ? ordinal(r.position) : '', r.grade ?? '', r.remark]
    cells.forEach((text, i) => {
      const col = COLS[i]
      doc.rect(x, y, col.w, rowH)
      doc.setFont('helvetica', i === 3 || i === 5 ? 'bold' : 'normal')
      const ty = y + rowH / 2 + 1.1
      if (col.align === 'center') fitText(doc, text, x + col.w / 2, ty, col.w - 2, bodySize, 5, { align: 'center' })
      else fitText(doc, text, x + 1.2, ty, col.w - 2.4, bodySize, 4.8)
      x += col.w
    })
    y += rowH
  })

  // Totals line
  y += 6.5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(`TOTAL SCORE: ${num(c.total)}`, M, y)
  doc.text(`AVERAGE: ${c.average === null ? '' : c.average.toFixed(1)}`, M + 60, y)
  doc.text(`SUBJECTS: ${rows.filter((r) => r.total !== null).length}`, M + 110, y)

  // ---- Remarks (left for handwriting, as on the printed card)
  y += 9
  const line = (label: string, value = '') => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(label, M, y)
    const sx = M + doc.getTextWidth(label) + 2
    dotted(doc, sx, M + W, y + 1)
    if (value) {
      doc.setFont('helvetica', 'normal')
      fitText(doc, value, sx + 1, y - 0.3, M + W - sx - 2, 8.5, 6)
    }
    y += 8
  }
  if (o.jhs9) line('BEST OF AGGREGATES:', c.aggregate ? `${c.aggregate.total}   (${c.aggregate.parts})` : '')
  line("Class Teacher's Remarks:")
  line("Head Teacher's Remarks:")

  // ---- Fees reminder
  y += 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('FEES REMINDER', M + W / 2, y, { align: 'center' })
  const tw = doc.getTextWidth('FEES REMINDER')
  doc.setLineWidth(0.4)
  doc.line(M + W / 2 - tw / 2, y + 1, M + W / 2 + tw / 2, y + 1)
  y += 8

  const f = c.fees
  const money = (n: number | undefined) => (f && n !== undefined ? gh(n) : '')
  const feeLine = (label: string, value: string, x1: number, yy: number, w: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(8.5)
    doc.text(label, x1, yy)
    const sx = x1 + doc.getTextWidth(label) + 1.5
    dotted(doc, sx, x1 + w, yy + 1)
    if (value) {
      doc.setFont('helvetica', 'bold')
      doc.text(value, x1 + w - 1, yy - 0.3, { align: 'right' })
    }
  }
  const half = W / 2 - 5
  feeLine('Arrears from last term GH¢', f ? f.arrears.toFixed(2) : '', M, y, half)
  feeLine('Tuition fees GH¢', f ? f.tuition.toFixed(2) : '', M + W / 2 + 5, y, half)
  y += 8
  feeLine('Exams fees GH¢', f ? f.exams.toFixed(2) : '', M, y, half)
  feeLine('Extra Classes GH¢', f ? f.extra.toFixed(2) : '', M + W / 2 + 5, y, half)
  y += 8
  feeLine('Feeding fees GH¢', f ? f.feeding.toFixed(2) : '', M, y, half)
  feeLine('GRAND TOTAL GH¢', f ? f.grandTotal.toFixed(2) : '', M + W / 2 + 5, y, half, true)
  y += 8
  feeLine('I.C.T. fees GH¢', f ? f.ict.toFixed(2) : '', M, y, half)
  void money

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text("Parent's/Guardian's sign: ____________________", M + W, 297 - M, { align: 'right' })
}

/** One A4 page per student */
export async function buildReportCardsPdf(cards: Card[], opts: Omit<Opts, 'date'> & { date: string }, filename: string) {
  const logo = await imageToDataUrl(schoolLogo)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const o = { ...opts, date: opts.date ? dmy(opts.date) : '' }
  cards.forEach((c, i) => {
    if (i > 0) doc.addPage()
    drawCard(doc, c, o, logo)
  })
  doc.save(filename)
}
