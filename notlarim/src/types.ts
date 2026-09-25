export type NoteType = 'text' | 'drawing'
export type DrawMode = 'notebook' | 'canvas'
export type PaperStyle = 'blank' | 'lined' | 'grid' | 'dots'

export interface Folder {
  id: string
  name: string
  createdAt: number
}

export interface NoteMeta {
  id: string
  type: NoteType
  title: string
  folderId: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Plain text used for search (text notes). */
  searchText: string
  drawMode?: DrawMode
  paper?: PaperStyle
  /** Set when the drawing was created from a PDF. */
  pdf?: { name: string; pages: number }
}

export interface TextContent {
  noteId: string
  doc: unknown
}

/** [x, y, pressure] in page coordinates. */
export type Point = [number, number, number]

export interface Stroke {
  id: string
  tool: 'pen' | 'highlighter'
  color: string
  size: number
  /** true when pressure was simulated (finger / mouse). */
  sp: boolean
  points: Point[]
  /** Straight shapes (line, arrow, box, ellipse) render with an even width. */
  shape?: boolean
  /** When the stroke was drawn (epoch ms), used to link it to an audio recording. */
  t?: number
}

/** An image placed on a drawing page, in page coordinates. */
export interface ImageItem {
  id: string
  fileId: string
  x: number
  y: number
  w: number
  h: number
}

export interface PdfBackground {
  kind: 'pdf'
  fileId: string
  /** 1-based page number inside the PDF. */
  page: number
}

export interface Page {
  id: string
  strokes: Stroke[]
  images?: ImageItem[]
  /** Page height in page units (width is always 1000). Defaults to A4. */
  h?: number
  bg?: PdfBackground
  /** Overrides the note's paper, e.g. lined pages added between PDF slides. */
  paper?: PaperStyle
}

/** Binary attachments (PDFs, images). Stored as ArrayBuffer, which every Safari version keeps reliably. */
export interface StoredFile {
  id: string
  noteId: string
  mime: string
  name?: string
  createdAt: number
  data: ArrayBuffer
}

export interface DrawingContent {
  noteId: string
  pages: Page[]
}

export interface MetaEntry {
  key: string
  value: unknown
}

export type TranscriptErrorCode = 'model' | 'decode' | 'memory' | 'cancelled' | 'interrupted' | 'offline' | 'unknown'

export type RecordingTranscript =
  | { status: 'processing'; progress: number; updatedAt: number }
  | { status: 'done'; text: string; language?: string; updatedAt: number }
  | { status: 'error'; error: TranscriptErrorCode; updatedAt: number }

export interface Recording {
  id: string
  noteId: string
  /** Set once the audio is assembled into a stored file. */
  fileId: string | null
  startedAt: number
  /** Milliseconds. */
  duration: number
  mime: string
  status: 'recording' | 'done'
  lastChunkAt?: number
  transcript?: RecordingTranscript
}

/** Audio arrives in small pieces while recording, so a crash loses seconds, not the lecture. */
export interface AudioChunk {
  id?: number
  recId: string
  seq: number
  data: ArrayBuffer
}

/** One text run on a PDF page: [text, x, y, w, h] in page units (width 1000). */
export type PdfTextItem = [string, number, number, number, number]

export interface PdfText {
  noteId: string
  pages: { t: string; i: PdfTextItem[] }[]
}
