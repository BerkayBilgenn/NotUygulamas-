import type { JSONContent } from '@tiptap/react'
import type { NoteType, RecordingTranscript } from '../types'

export type TranscriptAction = 'copy' | 'insert' | 'retry'

export function buildTranscriptContent(text: string, startedAt: number): JSONContent[] {
  const heading = new Date(startedAt).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const paragraphs = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  return [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Ses transkripti · ${heading}` }] },
    ...paragraphs.map((line): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  ]
}

export function transcriptActions(noteType: NoteType, transcript: RecordingTranscript): TranscriptAction[] {
  if (transcript.status !== 'done') return []
  return noteType === 'text' ? ['copy', 'insert', 'retry'] : ['copy', 'retry']
}
