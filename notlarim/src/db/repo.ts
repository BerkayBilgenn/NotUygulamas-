import { db } from './db'
import { uid } from '../lib/id'
import { savedBus, showToast } from '../lib/events'
import type { DrawMode, Folder, NoteMeta, Page, PaperStyle, PdfText, StoredFile } from '../types'

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError'
}

let lastQuotaToast = 0
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isQuotaError(e) && Date.now() - lastQuotaToast > 10000) {
      lastQuotaToast = Date.now()
      showToast('Depolama alanı doldu, son değişiklik kaydedilemedi. Ayarlardan yedek alıp eski notları silebilirsin.', 'error', 9000)
    }
    throw e
  }
}

function markSaved(id: string) {
  savedBus.dispatchEvent(new CustomEvent('saved', { detail: id }))
}

function baseNote(type: NoteMeta['type'], folderId: string | null): NoteMeta {
  const now = Date.now()
  return { id: uid(), type, title: '', folderId, tags: [], createdAt: now, updatedAt: now, deletedAt: null, searchText: '' }
}

export async function createTextNote(folderId: string | null): Promise<string> {
  const note = baseNote('text', folderId)
  await guard(() =>
    db.transaction('rw', db.notes, db.texts, async () => {
      await db.notes.add(note)
      await db.texts.add({ noteId: note.id, doc: { type: 'doc', content: [{ type: 'paragraph' }] } })
    }),
  )
  return note.id
}

export async function createDrawingNote(folderId: string | null, drawMode: DrawMode, paper: PaperStyle): Promise<string> {
  const note: NoteMeta = { ...baseNote('drawing', folderId), drawMode, paper }
  await guard(() =>
    db.transaction('rw', db.notes, db.drawings, async () => {
      await db.notes.add(note)
      await db.drawings.add({ noteId: note.id, pages: [{ id: uid(), strokes: [] }] })
    }),
  )
  return note.id
}

export async function updateNote(id: string, patch: Partial<Omit<NoteMeta, 'id'>>) {
  await guard(() => db.notes.update(id, { ...patch, updatedAt: Date.now() }))
  markSaved(id)
}

export async function saveText(id: string, doc: unknown, plain: string) {
  await guard(() =>
    db.transaction('rw', db.notes, db.texts, async () => {
      await db.texts.put({ noteId: id, doc })
      await db.notes.update(id, { searchText: plain.slice(0, 20000), updatedAt: Date.now() })
    }),
  )
  markSaved(id)
}

export async function saveDrawing(id: string, pages: Page[]) {
  await guard(() =>
    db.transaction('rw', db.notes, db.drawings, async () => {
      await db.drawings.put({ noteId: id, pages })
      await db.notes.update(id, { updatedAt: Date.now() })
    }),
  )
  markSaved(id)
}

export async function trashNote(id: string) {
  await guard(() => db.notes.update(id, { deletedAt: Date.now() }))
}

export async function restoreNote(id: string) {
  await guard(() => db.notes.update(id, { deletedAt: null }))
}

export async function deleteNoteForever(id: string) {
  await db.transaction('rw', [db.notes, db.texts, db.drawings, db.files, db.recordings, db.audiochunks, db.pdftext], async () => {
    const recIds = await db.recordings.where('noteId').equals(id).primaryKeys()
    if (recIds.length) await db.audiochunks.where('recId').anyOf(recIds).delete()
    await db.recordings.where('noteId').equals(id).delete()
    await db.pdftext.delete(id)
    await db.notes.delete(id)
    await db.texts.delete(id)
    await db.drawings.delete(id)
    await db.files.where('noteId').equals(id).delete()
  })
}

export async function saveFile(noteId: string, data: ArrayBuffer, mime: string, name?: string): Promise<string> {
  const file: StoredFile = { id: uid(), noteId, mime, name, createdAt: Date.now(), data }
  await guard(() => db.files.add(file))
  return file.id
}

/** Creates a notebook whose pages are the pages of a PDF. */
export async function createPdfNote(
  folderId: string | null,
  name: string,
  data: ArrayBuffer,
  pageSizes: [number, number][],
): Promise<string> {
  const note: NoteMeta = {
    ...baseNote('drawing', folderId),
    title: name.replace(/\.pdf$/i, ''),
    drawMode: 'notebook',
    paper: 'blank',
    pdf: { name, pages: pageSizes.length },
  }
  const fileId = uid()
  const pages: Page[] = pageSizes.map(([w, h], i) => ({
    id: uid(),
    strokes: [],
    h: Math.round((1000 * h) / w),
    bg: { kind: 'pdf', fileId, page: i + 1 },
  }))
  await guard(() =>
    db.transaction('rw', [db.notes, db.drawings, db.files], async () => {
      await db.files.add({ id: fileId, noteId: note.id, mime: 'application/pdf', name, createdAt: Date.now(), data })
      await db.notes.add(note)
      await db.drawings.add({ noteId: note.id, pages })
    }),
  )
  return note.id
}

export async function createFolder(name: string): Promise<Folder> {
  const folder: Folder = { id: uid(), name: name.trim(), createdAt: Date.now() }
  await guard(() => db.folders.add(folder))
  return folder
}

export async function renameFolder(id: string, name: string) {
  await guard(() => db.folders.update(id, { name: name.trim() }))
}

/** Notes in the folder are kept and moved out of it. */
export async function deleteFolder(id: string) {
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.notes.where('folderId').equals(id).modify({ folderId: null })
    await db.folders.delete(id)
  })
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await guard(() => db.meta.put({ key, value }))
}

/** Stores a PDF's text and makes the note findable from the sidebar search. */
export async function savePdfText(noteId: string, pages: PdfText['pages']) {
  const searchText = pages.map((p) => p.t).join('\n').slice(0, 300_000)
  await guard(() =>
    db.transaction('rw', db.pdftext, db.notes, async () => {
      await db.pdftext.put({ noteId, pages })
      await db.notes.update(noteId, { searchText })
    }),
  )
}
