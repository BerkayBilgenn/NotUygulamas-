import type { PDFDocument, PDFImage } from 'pdf-lib'
import { db } from '../db/db'

/** Embeds a stored image; formats pdf-lib can't take directly (webp, gif, heic) are converted to PNG first. */
export async function embedStoredImage(doc: PDFDocument, fileId: string, cache: Map<string, PDFImage | null>): Promise<PDFImage | null> {
  if (cache.has(fileId)) return cache.get(fileId)!
  const f = await db.files.get(fileId)
  let img: PDFImage | null = null
  if (f) {
    try {
      if (f.mime === 'image/jpeg') img = await doc.embedJpg(f.data)
      else if (f.mime === 'image/png') img = await doc.embedPng(f.data)
      else img = await doc.embedPng(await toPng(new Blob([f.data], { type: f.mime })))
    } catch (e) {
      console.warn('[notlarim] image skipped in PDF', e)
    }
  }
  cache.set(fileId, img)
  return img
}

async function toPng(blob: Blob): Promise<ArrayBuffer> {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'))
  c.width = c.height = 0
  return png.arrayBuffer()
}
