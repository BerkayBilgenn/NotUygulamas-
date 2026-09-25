import { PDFDocument, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import type { NoteMeta } from '../types'
import { C } from './colors'
import { loadFonts, type FontStack, type Fonts } from './fonts'
import { embedStoredImage } from './images'

/** Minimal shape of Tiptap's JSON document. */
export interface DocNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 54
const MARGIN_TOP = 58
const MARGIN_BOTTOM = 62
const BASE = 11

interface Style {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  highlight?: boolean
  sub?: boolean
  sup?: boolean
  code?: boolean
  link?: boolean
}

interface Run {
  text: string
  st: Style
  br?: boolean
}

interface Atom {
  text: string
  st: Style
  w: number
  size: number
  font: FontStack
  space: boolean
  br?: boolean
}

interface Ctx {
  x: number
  width: number
  size: number
  color: RGB
  heading?: boolean
  strikeAll?: boolean
  /** x positions of blockquote bars to draw next to every line. */
  bars: number[]
  /** List marker waiting for the baseline of the item's first line. */
  marker?: { draw: (baseline: number, size: number) => void; used: boolean }
}

class Writer {
  page!: PDFPage
  y = 0
  readonly pages: PDFPage[] = []
  readonly images = new Map<string, PDFImage | null>()
  readonly doc: PDFDocument
  readonly fonts: Fonts
  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc
    this.fonts = fonts
    this.newPage()
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.pages.push(this.page)
    this.y = PAGE_H - MARGIN_TOP
  }
  ensure(h: number) {
    if (this.y - h < MARGIN_BOTTOM) this.newPage()
  }
  get atTop() {
    return this.y >= PAGE_H - MARGIN_TOP - 0.5
  }
}

function stackFor(fonts: Fonts, st: Style, heading?: boolean): FontStack {
  if (heading) return fonts.heading
  if (st.bold && st.italic) return fonts.boldItalic
  if (st.bold) return fonts.bold
  if (st.italic) return fonts.italic
  return fonts.regular
}

function styleOf(marks: DocNode['marks']): Style {
  const st: Style = {}
  for (const m of marks ?? []) {
    if (m.type === 'bold') st.bold = true
    else if (m.type === 'italic') st.italic = true
    else if (m.type === 'underline') st.underline = true
    else if (m.type === 'strike') st.strike = true
    else if (m.type === 'highlight') st.highlight = true
    else if (m.type === 'subscript') st.sub = true
    else if (m.type === 'superscript') st.sup = true
    else if (m.type === 'code') st.code = true
    else if (m.type === 'link') st.link = true
  }
  return st
}

function runsOf(node: DocNode): Run[] {
  const runs: Run[] = []
  for (const c of node.content ?? []) {
    if (c.type === 'text' && c.text) runs.push({ text: c.text, st: styleOf(c.marks) })
    else if (c.type === 'hardBreak') runs.push({ text: '', st: {}, br: true })
  }
  return runs
}

function atomize(w: Writer, runs: Run[], ctx: Ctx): Atom[] {
  const atoms: Atom[] = []
  for (const r of runs) {
    if (r.br) {
      atoms.push({ text: '', st: {}, w: 0, size: ctx.size, font: w.fonts.regular, space: false, br: true })
      continue
    }
    const font = stackFor(w.fonts, r.st, ctx.heading)
    const size = r.st.sub || r.st.sup ? ctx.size * 0.72 : ctx.size
    for (const piece of r.text.split(/(\s+)/)) {
      if (!piece) continue
      const space = /^\s+$/.test(piece)
      const text = space ? ' ' : piece
      atoms.push({ text, st: r.st, w: font.width(text, size), size, font, space })
    }
  }
  return atoms
}

function layout(atoms: Atom[], maxW: number): Atom[][] {
  const lines: Atom[][] = []
  let line: Atom[] = []
  let lw = 0
  const flush = () => {
    while (line.length && line[line.length - 1].space) line.pop()
    lines.push(line)
    line = []
    lw = 0
  }
  for (const a of atoms) {
    if (a.br) {
      flush()
      continue
    }
    if (a.space && !line.length) continue
    if (lw + a.w > maxW && line.length) {
      flush()
      if (a.space) continue
    }
    if (a.w > maxW) {
      // A single word wider than the column (a long URL): break it by characters.
      let chunk = ''
      for (const ch of a.text) {
        const cw = a.font.width(chunk + ch, a.size)
        if (cw > maxW - lw && chunk) {
          line.push({ ...a, text: chunk, w: a.font.width(chunk, a.size) })
          flush()
          chunk = ''
        }
        chunk += ch
      }
      if (chunk) {
        const piece = { ...a, text: chunk, w: a.font.width(chunk, a.size) }
        line.push(piece)
        lw += piece.w
      }
      continue
    }
    line.push(a)
    lw += a.w
  }
  if (line.length || !lines.length) flush()
  return lines
}

function drawLine(w: Writer, line: Atom[], ctx: Ctx, baseline: number) {
  const color = ctx.strikeAll ? C.muted : ctx.color
  // Backgrounds first so text sits on top.
  let x = ctx.x
  for (const a of line) {
    if (a.st.highlight) w.page.drawRectangle({ x, y: baseline - ctx.size * 0.28, width: a.w, height: ctx.size * 1.2, color: C.highlight, opacity: 0.65 })
    if (a.st.code && !a.space) w.page.drawRectangle({ x: x - 1, y: baseline - ctx.size * 0.25, width: a.w + 2, height: ctx.size * 1.1, color: C.soft })
    x += a.w
  }
  x = ctx.x
  for (const a of line) {
    if (!a.space) {
      const shift = a.st.sup ? ctx.size * 0.34 : a.st.sub ? -ctx.size * 0.16 : 0
      let sx = x
      for (const seg of a.font.segments(a.text)) {
        try {
          w.page.drawText(seg.text, { x: sx, y: baseline + shift, size: a.size, font: seg.font, color: a.st.link ? C.pink : color })
        } catch {
          /* a glyph none of the fonts have: skip it rather than fail the whole export */
        }
        sx += a.font.width(seg.text, a.size)
      }
    }
    const thickness = Math.max(0.5, ctx.size * 0.06)
    if (a.st.underline || a.st.link) w.page.drawLine({ start: { x, y: baseline - 1.6 }, end: { x: x + a.w, y: baseline - 1.6 }, thickness, color: a.st.link ? C.pink : color })
    if (a.st.strike || ctx.strikeAll) {
      const sy = baseline + ctx.size * 0.3
      w.page.drawLine({ start: { x, y: sy }, end: { x: x + a.w, y: sy }, thickness, color: ctx.strikeAll ? C.margin : color })
    }
    x += a.w
  }
}

function lineHeight(ctx: Ctx) {
  return ctx.size * (ctx.heading ? 1.3 : 1.5)
}

function drawBars(w: Writer, ctx: Ctx, lh: number) {
  for (const bx of ctx.bars) w.page.drawRectangle({ x: bx, y: w.y - lh, width: 2.4, height: lh, color: C.margin })
}

function paragraph(w: Writer, node: DocNode, ctx: Ctx, gapAfter = 4) {
  const lines = layout(atomize(w, runsOf(node), ctx), ctx.width)
  const lh = lineHeight(ctx)
  for (const line of lines) {
    w.ensure(lh)
    const baseline = w.y - ctx.size * 1.08
    drawBars(w, ctx, lh)
    if (ctx.marker && !ctx.marker.used) {
      ctx.marker.used = true
      ctx.marker.draw(baseline, ctx.size)
    }
    drawLine(w, line, ctx, baseline)
    w.y -= lh
  }
  w.y -= gapAfter
}

async function block(w: Writer, node: DocNode, ctx: Ctx): Promise<void> {
  switch (node.type) {
    case 'paragraph':
      return paragraph(w, node, ctx)
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      const size = level === 1 ? 19 : level === 2 ? 15.5 : 13
      if (!w.atTop) w.y -= level === 1 ? 10 : 7
      return paragraph(w, node, { ...ctx, size, heading: true, color: C.burgundy }, 3)
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const indent = node.type === 'orderedList' ? 18 : 15
      const start = Number(node.attrs?.start ?? 1)
      let i = 0
      for (const item of node.content ?? []) {
        const n = start + i++
        const checked = node.type === 'taskList' && item.attrs?.checked === true
        const markerX = ctx.x
        const draw = (baseline: number, size: number) => {
          if (node.type === 'bulletList') {
            w.page.drawCircle({ x: markerX + 4, y: baseline + size * 0.3, size: size * 0.15, color: C.pink })
          } else if (node.type === 'orderedList') {
            const label = `${n}.`
            const lw = w.fonts.bold.width(label, size)
            for (const seg of w.fonts.bold.segments(label)) w.page.drawText(seg.text, { x: markerX + indent - 5 - lw, y: baseline, size, font: seg.font, color: C.pink })
          } else {
            const s = size * 0.82
            const by = baseline - size * 0.08
            w.page.drawRectangle({ x: markerX, y: by, width: s, height: s, borderColor: C.pink, borderWidth: 1.1, color: checked ? C.pink : C.white })
            if (checked) {
              w.page.drawLine({ start: { x: markerX + s * 0.2, y: by + s * 0.5 }, end: { x: markerX + s * 0.42, y: by + s * 0.25 }, thickness: 1.3, color: C.white })
              w.page.drawLine({ start: { x: markerX + s * 0.42, y: by + s * 0.25 }, end: { x: markerX + s * 0.82, y: by + s * 0.75 }, thickness: 1.3, color: C.white })
            }
          }
        }
        const child: Ctx = { ...ctx, x: ctx.x + indent, width: ctx.width - indent, strikeAll: ctx.strikeAll || checked, marker: { draw, used: false } }
        for (const c of item.content ?? []) await block(w, c, child)
      }
      w.y -= 2
      return
    }
    case 'blockquote': {
      const child: Ctx = { ...ctx, x: ctx.x + 13, width: ctx.width - 13, color: C.muted, bars: [...ctx.bars, ctx.x + 1] }
      for (const c of node.content ?? []) await block(w, c, child)
      w.y -= 3
      return
    }
    case 'codeBlock': {
      const size = BASE * 0.88
      const text = (node.content ?? []).map((c) => c.text ?? '').join('')
      const cctx: Ctx = { ...ctx, x: ctx.x + 6, width: ctx.width - 12, size }
      const lh = lineHeight(cctx)
      for (const raw of text.split('\n')) {
        const lines = layout(atomize(w, [{ text: raw || ' ', st: {} }], cctx), cctx.width)
        for (const line of lines) {
          w.ensure(lh)
          w.page.drawRectangle({ x: ctx.x, y: w.y - lh, width: ctx.width, height: lh, color: C.soft })
          drawLine(w, line, cctx, w.y - size * 1.08)
          w.y -= lh
        }
      }
      w.y -= 6
      return
    }
    case 'horizontalRule': {
      w.ensure(14)
      w.page.drawLine({ start: { x: ctx.x, y: w.y - 7 }, end: { x: ctx.x + ctx.width, y: w.y - 7 }, thickness: 1, color: C.margin, dashArray: [3, 3] })
      w.y -= 14
      return
    }
    case 'image': {
      const fileId = node.attrs?.fileId as string | undefined
      if (!fileId) return
      const img = await embedStoredImage(w.doc, fileId, w.images)
      if (!img) return
      const pct = Math.min(100, Number(node.attrs?.width ?? 100)) / 100
      let iw = ctx.width * pct
      let ih = (iw * img.height) / img.width
      const maxH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM
      if (ih > maxH) {
        iw *= maxH / ih
        ih = maxH
      }
      w.ensure(ih + 4)
      w.page.drawImage(img, { x: ctx.x, y: w.y - ih - 2, width: iw, height: ih })
      w.y -= ih + 10
      return
    }
    case 'table':
      return table(w, node, ctx)
    default:
      for (const c of node.content ?? []) await block(w, c, ctx)
  }
}

function flattenRuns(node: DocNode): Run[] {
  const out: Run[] = []
  const visit = (n: DocNode) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      if (out.length) out.push({ text: '', st: {}, br: true })
      out.push(...runsOf(n))
      return
    }
    for (const c of n.content ?? []) visit(c)
  }
  visit(node)
  return out
}

function table(w: Writer, node: DocNode, ctx: Ctx) {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow')
  const cols = Math.max(1, ...rows.map((r) => r.content?.length ?? 0))
  const colW = ctx.width / cols
  const pad = 5
  const cctx: Ctx = { ...ctx, size: BASE * 0.9, bars: [] }
  const lh = lineHeight(cctx)
  w.y -= 2
  for (const row of rows) {
    const cells = (row.content ?? []).map((cell) => {
      const header = cell.type === 'tableHeader'
      const runs = flattenRuns(cell).map((r) => (header ? { ...r, st: { ...r.st, bold: true } } : r))
      return { header, lines: layout(atomize(w, runs, cctx), colW - pad * 2) }
    })
    const rowH = Math.max(lh + pad * 2, ...cells.map((c) => c.lines.length * lh + pad * 2))
    w.ensure(rowH)
    cells.forEach((cell, ci) => {
      const x = ctx.x + ci * colW
      w.page.drawRectangle({ x, y: w.y - rowH, width: colW, height: rowH, color: cell.header ? C.soft : C.white, borderColor: C.line, borderWidth: 0.9 })
      let ly = w.y - pad
      for (const line of cell.lines) {
        drawLine(w, line, { ...cctx, x: x + pad, color: cell.header ? C.burgundy : ctx.color }, ly - cctx.size * 1.08)
        ly -= lh
      }
    })
    w.y -= rowH
  }
  w.y -= 8
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function textToPdf(note: NoteMeta, doc: DocNode): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(note.title || 'notlarım')
  pdf.setCreator('notlarım')
  const fonts = await loadFonts(pdf)
  const w = new Writer(pdf, fonts)
  const width = PAGE_W - MARGIN_X * 2
  const ctx: Ctx = { x: MARGIN_X, width, size: BASE, color: C.ink, bars: [] }

  // Title block
  paragraph(w, { content: [{ type: 'text', text: note.title || 'Başlıksız not' }] }, { ...ctx, size: 21, heading: true, color: C.burgundy }, 2)
  paragraph(w, { content: [{ type: 'text', text: formatDate(note.updatedAt) }] }, { ...ctx, size: 9, color: C.muted }, 6)
  w.page.drawLine({ start: { x: MARGIN_X, y: w.y }, end: { x: MARGIN_X + width, y: w.y }, thickness: 1, color: C.line })
  w.y -= 14

  for (const c of doc.content ?? []) await block(w, c, ctx)

  const total = w.pages.length
  w.pages.forEach((p, i) => {
    const label = `notlarım  ·  ${i + 1} / ${total}`
    const size = 8
    const lw = fonts.regular.width(label, size)
    let x = (PAGE_W - lw) / 2
    for (const seg of fonts.regular.segments(label)) {
      p.drawText(seg.text, { x, y: 30, size, font: seg.font, color: C.muted })
      x += seg.font.widthOfTextAtSize(seg.text, size)
    }
  })
  return pdf.save()
}
