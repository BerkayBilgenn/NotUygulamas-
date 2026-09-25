import { BlendMode, PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib'
import { db } from '../db/db'
import { PAGE_W, LINE_SPACING, pageH, strokeBounds, strokeSvgPath } from '../drawing/render'
import type { NoteMeta, Page, PaperStyle } from '../types'
import { C, hexToRgb } from './colors'
import { embedStoredImage } from './images'

const A4_W = 595.28

interface Frame {
  page: PDFPage
  /** PDF x of page-unit 0, PDF y of page-unit 0 (top), points per page unit. */
  ox: number
  top: number
  k: number
}

/**
 * Vector export: ink stays sharp at any zoom, and PDF slides are copied in as
 * the original pages (selectable text, full quality) with the notes on top.
 */
export async function drawingToPdf(note: NoteMeta, pages: Page[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  out.setTitle(note.title || 'notlarım')
  out.setCreator('notlarım')
  const sources = new Map<string, PDFDocument>()
  const images = new Map<string, PDFImage | null>()
  const paper = note.paper ?? 'lined'

  if ((note.drawMode ?? 'notebook') === 'canvas') {
    const pg = pages[0] ?? { id: 'p', strokes: [] }
    const b = contentBounds(pg)
    const k = 0.6
    const w = Math.max(A4_W, (b.x1 - b.x0) * k)
    const h = Math.max(A4_W * 1.414, (b.y1 - b.y0) * k)
    const page = out.addPage([w, h])
    const frame: Frame = { page, ox: -b.x0 * k, top: h + b.y0 * k, k }
    paintPaper(frame, paper, b.x0, b.y0, b.x0 + w / k, b.y0 + h / k, false)
    await paintContent(out, frame, pg, images)
  } else {
    for (const pg of pages) {
      let frame: Frame
      if (pg.bg) {
        let src = sources.get(pg.bg.fileId)
        if (!src) {
          const f = await db.files.get(pg.bg.fileId)
          src = f ? await PDFDocument.load(f.data, { ignoreEncryption: true }) : undefined
          if (src) sources.set(pg.bg.fileId, src)
        }
        if (src && pg.bg.page - 1 < src.getPageCount()) {
          const [copied] = await out.copyPages(src, [pg.bg.page - 1])
          out.addPage(copied)
          const box = copied.getCropBox()
          frame = { page: copied, ox: box.x, top: box.y + box.height, k: box.width / PAGE_W }
        } else {
          frame = blankPage(out, pageH(pg))
        }
      } else {
        frame = blankPage(out, pageH(pg))
        paintPaper(frame, pg.paper ?? paper, 0, 0, PAGE_W, pageH(pg), true)
      }
      await paintContent(out, frame, pg, images)
    }
  }
  if (!out.getPageCount()) out.addPage([A4_W, A4_W * 1.414])
  return out.save()
}

function blankPage(out: PDFDocument, h: number): Frame {
  const k = A4_W / PAGE_W
  const page = out.addPage([A4_W, h * k])
  return { page, ox: 0, top: h * k, k }
}

function contentBounds(pg: Page) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of pg.strokes) {
    const b = strokeBounds(s)
    x0 = Math.min(x0, b.x0)
    y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1)
    y1 = Math.max(y1, b.y1)
  }
  for (const im of pg.images ?? []) {
    x0 = Math.min(x0, im.x)
    y0 = Math.min(y0, im.y)
    x1 = Math.max(x1, im.x + im.w)
    y1 = Math.max(y1, im.y + im.h)
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: PAGE_W, y1: PAGE_W * 1.414 }
  const m = 40
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m }
}

function paintPaper(f: Frame, style: PaperStyle, x0: number, y0: number, x1: number, y1: number, notebook: boolean) {
  const X = (x: number) => f.ox + x * f.k
  const Y = (y: number) => f.top - y * f.k
  const s = LINE_SPACING
  const thickness = 0.6
  if (style === 'lined') {
    for (let y = Math.max(notebook ? 110 : y0, Math.ceil(y0 / s) * s); y <= y1; y += s) {
      f.page.drawLine({ start: { x: X(x0), y: Y(y) }, end: { x: X(x1), y: Y(y) }, thickness, color: C.line })
    }
    if (notebook) f.page.drawLine({ start: { x: X(88), y: Y(y0) }, end: { x: X(88), y: Y(y1) }, thickness, color: C.margin, opacity: 0.55 })
  } else if (style === 'grid') {
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) f.page.drawLine({ start: { x: X(x0), y: Y(y) }, end: { x: X(x1), y: Y(y) }, thickness, color: C.grid })
    for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) f.page.drawLine({ start: { x: X(x), y: Y(y0) }, end: { x: X(x), y: Y(y1) }, thickness, color: C.grid })
  } else if (style === 'dots') {
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s)
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) f.page.drawCircle({ x: X(x), y: Y(y), size: 0.8, color: C.line })
  }
}

async function paintContent(out: PDFDocument, f: Frame, pg: Page, images: Map<string, PDFImage | null>) {
  for (const im of pg.images ?? []) {
    const img = await embedStoredImage(out, im.fileId, images)
    if (!img) continue
    f.page.drawImage(img, { x: f.ox + im.x * f.k, y: f.top - (im.y + im.h) * f.k, width: im.w * f.k, height: im.h * f.k })
  }
  for (const s of pg.strokes) {
    const d = strokeSvgPath(s)
    if (!d) continue
    const hl = s.tool === 'highlighter'
    f.page.drawSvgPath(d, {
      x: f.ox,
      y: f.top,
      scale: f.k,
      color: hexToRgb(s.color),
      opacity: hl ? 0.42 : 1,
      blendMode: hl ? BlendMode.Multiply : undefined,
    })
  }
}
