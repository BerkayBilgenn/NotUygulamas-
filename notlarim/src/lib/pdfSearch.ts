import type { Page, PdfText } from '../types'
import { normalizeTr } from './search'

export interface PdfHit {
  /** Index of the notebook page (inserted blank pages shift PDF pages). */
  pageIndex: number
  pdfPage: number
  snippet: { before: string; match: string; after: string }
  rects: [number, number, number, number][]
}

export function snippetAround(text: string, token: string, radius = 48) {
  const norm = normalizeTr(text)
  const at = norm.indexOf(token)
  if (at < 0) return { before: text.slice(0, radius * 2), match: '', after: '' }
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + token.length + radius)
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, at).replace(/\s+/g, ' '),
    match: text.slice(at, at + token.length),
    after: text.slice(at + token.length, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : ''),
  }
}

/** Every page containing all words of the query, in page order. */
export function searchPdf(pdf: PdfText, pages: Page[], query: string): PdfHit[] {
  const tokens = normalizeTr(query).trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const hits: PdfHit[] = []
  pages.forEach((pg, pageIndex) => {
    if (!pg.bg) return
    const src = pdf.pages[pg.bg.page - 1]
    if (!src) return
    const norm = normalizeTr(src.t)
    if (!tokens.every((t) => norm.includes(t))) return
    const rects = src.i.filter(([str]) => tokens.some((t) => normalizeTr(str).includes(t))).map(([, x, y, w, h]) => [x, y, w, h] as [number, number, number, number])
    hits.push({ pageIndex, pdfPage: pg.bg.page, snippet: snippetAround(src.t, tokens[0]), rects })
  })
  return hits
}
