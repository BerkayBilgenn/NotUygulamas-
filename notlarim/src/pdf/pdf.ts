import { Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import './worker'
import { db } from '../db/db'
import type { PdfText, PdfTextItem } from '../types'

export class PdfError extends Error {
  name = 'PdfError'
}

/** Reads page sizes (in PDF points) from a file the user picked. */
export async function readPdfPageSizes(data: ArrayBuffer): Promise<[number, number][]> {
  let doc: PDFDocumentProxy
  const task = getDocument({ data: new Uint8Array(data.slice(0)) })
  try {
    doc = await task.promise
  } catch (e) {
    if ((e as Error).name === 'PasswordException') throw new PdfError("Şifreli PDF'ler açılamıyor. Şifresiz bir kopyasını dene.")
    throw new PdfError('Bu PDF açılamadı. Dosya bozuk olabilir.')
  }
  try {
    const sizes: [number, number][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      sizes.push([vp.width, vp.height])
      page.cleanup()
    }
    return sizes
  } finally {
    void task.destroy()
  }
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

function openDoc(fileId: string): Promise<PDFDocumentProxy> {
  let p = docs.get(fileId)
  if (!p) {
    p = db.files.get(fileId).then((f) => {
      if (!f) throw new PdfError('PDF dosyası bulunamadı.')
      return getDocument({ data: new Uint8Array(f.data.slice(0)) }).promise
    })
    p.catch(() => docs.delete(fileId))
    docs.set(fileId, p)
  }
  return p
}

/** Renders one PDF page to a bitmap `widthPx` pixels wide. */
export async function renderPdfPage(fileId: string, pageNo: number, widthPx: number): Promise<ImageBitmap> {
  const doc = await openDoc(fileId)
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: widthPx / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise
  const bmp = await createImageBitmap(canvas)
  canvas.width = canvas.height = 0 // free the backing store right away (iPad memory is tight)
  page.cleanup()
  return bmp
}

/**
 * Pulls the text out of every page with its position, so slides can be
 * searched ("protamine") and matches highlighted. Scanned PDFs have no text
 * layer and simply come back empty.
 */
export async function extractPdfText(data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<PdfText['pages']> {
  const task = getDocument({ data: new Uint8Array(data.slice(0)) })
  try {
    const doc = await task.promise
    const pages: PdfText['pages'] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: 1000 / base.width })
      const content = await page.getTextContent()
      const items: PdfTextItem[] = []
      const parts: string[] = []
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) {
          if ('str' in it && it.hasEOL) parts.push('\n')
          continue
        }
        const tx = Util.transform(vp.transform, it.transform)
        const h = Math.hypot(tx[2], tx[3])
        const r = (v: number) => Math.round(v * 10) / 10
        items.push([it.str, r(tx[4]), r(tx[5] - h), r(it.width * vp.scale), r(h)])
        parts.push(it.str, it.hasEOL ? '\n' : ' ')
      }
      pages.push({ t: parts.join('').replace(/[ \t]+/g, ' ').trim(), i: items })
      page.cleanup()
      onProgress?.(n, doc.numPages)
    }
    return pages
  } finally {
    void task.destroy()
  }
}
