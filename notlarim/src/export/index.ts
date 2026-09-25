import { db } from '../db/db'
import type { NoteMeta } from '../types'
import { drawingToPdf } from './drawingPdf'
import { pdfFileName, shareOrDownload } from './share'
import { textToPdf, type DocNode } from './textPdf'

/** Builds a PDF of the note and hands it to the share sheet (or downloads it). */
export async function exportNotePdf(note: NoteMeta) {
  let bytes: Uint8Array
  if (note.type === 'text') {
    const t = await db.texts.get(note.id)
    bytes = await textToPdf(note, (t?.doc as DocNode) ?? { type: 'doc', content: [] })
  } else {
    const d = await db.drawings.get(note.id)
    bytes = await drawingToPdf(note, d?.pages ?? [])
  }
  return shareOrDownload(bytes, pdfFileName(note.title, note.type === 'text' ? 'not' : 'cizim'), 'application/pdf')
}
