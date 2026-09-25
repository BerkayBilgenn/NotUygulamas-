import { db } from '../db/db'
import type { DrawingContent, Folder, NoteMeta, Recording, StoredFile, TextContent, TranscriptErrorCode } from '../types'

/** v2 adds files, v3 recordings, and v4 embedded offline transcripts. Older files still import. */
export const BACKUP_VERSION = 4

export interface BackupFileEntry {
  id: string
  noteId: string
  mime: string
  name?: string
  createdAt: number
  base64: string
}

export interface BackupFile {
  app: 'notlarim'
  version: number
  exportedAt: number
  data: {
    folders: Folder[]
    notes: NoteMeta[]
    texts: TextContent[]
    drawings: DrawingContent[]
    files?: BackupFileEntry[]
    recordings?: Recording[]
  }
}

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export async function buildBackup(): Promise<BackupFile> {
  return db.transaction('r', [db.folders, db.notes, db.texts, db.drawings, db.files, db.recordings], async () => ({
    app: 'notlarim' as const,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: {
      folders: await db.folders.toArray(),
      notes: await db.notes.toArray(),
      texts: await db.texts.toArray(),
      drawings: await db.drawings.toArray(),
      files: (await db.files.toArray()).map(({ data, ...rest }) => ({ ...rest, base64: bytesToBase64(data) })),
      recordings: (await db.recordings.toArray()).filter((r) => r.status === 'done'),
    },
  }))
}

export class BackupError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const transcriptErrors = new Set<TranscriptErrorCode>(['model', 'decode', 'memory', 'cancelled', 'interrupted', 'offline', 'unknown'])

function isTranscript(v: unknown): boolean {
  if (!isObj(v) || typeof v.updatedAt !== 'number') return false
  if (v.status === 'processing') return typeof v.progress === 'number' && v.progress >= 0 && v.progress <= 100
  if (v.status === 'done') return typeof v.text === 'string' && (v.language === undefined || typeof v.language === 'string')
  return v.status === 'error' && typeof v.error === 'string' && transcriptErrors.has(v.error as TranscriptErrorCode)
}

/** Validates the whole file before anything is written. Throws BackupError with a user-facing message. */
export function parseBackup(raw: string): BackupFile {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new BackupError('Bu dosya okunamadı. notlarım yedek dosyası (.json) seçtiğinden emin ol.')
  }
  if (!isObj(json) || json.app !== 'notlarim' || !isObj(json.data)) {
    throw new BackupError('Bu dosya bir notlarım yedeği değil.')
  }
  if (typeof json.version !== 'number' || json.version > BACKUP_VERSION) {
    throw new BackupError('Bu yedek uygulamanın daha yeni bir sürümüyle alınmış. Önce sayfayı yenileyip uygulamayı güncelle.')
  }
  const d = json.data
  const lists = ['folders', 'notes', 'texts', 'drawings'] as const
  for (const k of lists) {
    if (!Array.isArray(d[k])) throw new BackupError('Yedek dosyası eksik ya da bozuk.')
  }
  const notes = d.notes as unknown[]
  for (const n of notes) {
    if (!isObj(n) || !isStr(n.id) || (n.type !== 'text' && n.type !== 'drawing') || typeof n.updatedAt !== 'number') {
      throw new BackupError('Yedek dosyasındaki bazı notlar bozuk, hiçbir şey değiştirilmedi.')
    }
  }
  for (const f of d.folders as unknown[]) {
    if (!isObj(f) || !isStr(f.id) || typeof f.name !== 'string') throw new BackupError('Yedek dosyasındaki klasörler bozuk, hiçbir şey değiştirilmedi.')
  }
  for (const t of d.texts as unknown[]) {
    if (!isObj(t) || !isStr(t.noteId)) throw new BackupError('Yedek dosyasındaki yazılı notlar bozuk, hiçbir şey değiştirilmedi.')
  }
  for (const dr of d.drawings as unknown[]) {
    if (!isObj(dr) || !isStr(dr.noteId) || !Array.isArray(dr.pages)) throw new BackupError('Yedek dosyasındaki çizimler bozuk, hiçbir şey değiştirilmedi.')
  }
  if (d.recordings !== undefined) {
    if (!Array.isArray(d.recordings)) throw new BackupError('Yedek dosyası eksik ya da bozuk.')
    for (const r of d.recordings as unknown[]) {
      if (!isObj(r) || !isStr(r.id) || !isStr(r.noteId) || typeof r.startedAt !== 'number') {
        throw new BackupError('Yedek dosyasındaki ses kayıtları bozuk, hiçbir şey değiştirilmedi.')
      }
      if (r.transcript !== undefined && !isTranscript(r.transcript)) {
        throw new BackupError('Yedek dosyasındaki ses transkriptleri bozuk, hiçbir şey değiştirilmedi.')
      }
    }
  }
  if (d.files !== undefined) {
    if (!Array.isArray(d.files)) throw new BackupError('Yedek dosyası eksik ya da bozuk.')
    for (const f of d.files as unknown[]) {
      if (!isObj(f) || !isStr(f.id) || !isStr(f.noteId) || !isStr(f.mime) || typeof f.base64 !== 'string') {
        throw new BackupError('Yedek dosyasındaki PDF ve resimler bozuk, hiçbir şey değiştirilmedi.')
      }
    }
  }
  return json as unknown as BackupFile
}

export interface RestoreResult {
  added: number
  updated: number
  keptNewer: number
}

/**
 * Merges a backup into the database. A note that exists in both places keeps
 * whichever copy was edited more recently, so restoring never overwrites newer work.
 */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, updated: 0, keptNewer: 0 }
  const { folders, notes, texts, drawings } = file.data
  // Decode attachments before opening the transaction: a bad base64 string must not leave half a restore behind.
  let files: StoredFile[]
  try {
    files = (file.data.files ?? []).map(({ base64, ...rest }) => ({ ...rest, createdAt: rest.createdAt ?? Date.now(), data: base64ToBytes(base64) }))
  } catch {
    throw new BackupError('Yedek dosyasındaki PDF ve resimler bozuk, hiçbir şey değiştirilmedi.')
  }
  const textById = new Map(texts.map((t) => [t.noteId, t]))
  const drawingById = new Map(drawings.map((d) => [d.noteId, d]))

  await db.transaction('rw', [db.folders, db.notes, db.texts, db.drawings, db.files, db.recordings], async () => {
    for (const f of folders) {
      if (!(await db.folders.get(f.id))) await db.folders.add(f)
    }
    // Attachments never change after they're created, so adding missing ones is enough.
    for (const f of files) {
      if (!(await db.files.get(f.id))) await db.files.add(f)
    }
    for (const r of file.data.recordings ?? []) {
      if (!(await db.recordings.get(r.id))) await db.recordings.add({ ...r, status: 'done' })
    }
    for (const incoming of notes) {
      // Older or hand-edited backups may miss optional fields; fill them in.
      const raw = incoming as Partial<NoteMeta> & Pick<NoteMeta, 'id' | 'type' | 'updatedAt'>
      const note: NoteMeta = {
        ...raw,
        title: raw.title ?? '',
        folderId: raw.folderId ?? null,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        createdAt: raw.createdAt ?? raw.updatedAt,
        deletedAt: raw.deletedAt ?? null,
        searchText: raw.searchText ?? '',
      }
      const existing = await db.notes.get(note.id)
      if (existing && existing.updatedAt >= note.updatedAt) {
        result.keptNewer++
        continue
      }
      if (existing) result.updated++
      else result.added++
      await db.notes.put(note)
      if (note.type === 'text') {
        const t = textById.get(note.id)
        await db.texts.put(t ?? { noteId: note.id, doc: { type: 'doc', content: [{ type: 'paragraph' }] } })
      } else {
        const d = drawingById.get(note.id)
        await db.drawings.put(d ?? { noteId: note.id, pages: [{ id: note.id + '-p1', strokes: [] }] })
      }
    }
  })
  return result
}

export function backupFileName(ts = Date.now()): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `notlarim-yedek-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}
