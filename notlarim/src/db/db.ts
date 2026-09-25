import Dexie, { type EntityTable } from 'dexie'
import type { AudioChunk, DrawingContent, Folder, MetaEntry, NoteMeta, PdfText, Recording, StoredFile, TextContent } from '../types'

export class NotesDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>
  notes!: EntityTable<NoteMeta, 'id'>
  texts!: EntityTable<TextContent, 'noteId'>
  drawings!: EntityTable<DrawingContent, 'noteId'>
  meta!: EntityTable<MetaEntry, 'key'>
  files!: EntityTable<StoredFile, 'id'>
  recordings!: EntityTable<Recording, 'id'>
  audiochunks!: EntityTable<AudioChunk, 'id'>
  pdftext!: EntityTable<PdfText, 'noteId'>

  constructor(name = 'notlarim') {
    super(name)
    // Schema changes: add a new version() with an upgrade() callback, never edit this one.
    this.version(1).stores({
      folders: 'id, createdAt',
      notes: 'id, type, folderId, updatedAt',
      texts: 'noteId',
      drawings: 'noteId',
      meta: 'key',
    })
    // v2 (Faz 2): PDFs and images.
    this.version(2).stores({
      files: 'id, noteId',
    })
    // v3: audio recordings and searchable PDF text.
    this.version(3).stores({
      recordings: 'id, noteId, status',
      audiochunks: '++id, recId',
      pdftext: 'noteId',
    })
  }
}

export const db = new NotesDB()
