import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Recording } from '../types'
import { recoverInterruptedTranscripts } from './transcriptRecovery'

const doneRecording: Recording = {
  id: 'rec-interrupted',
  noteId: 'note-1',
  fileId: 'file-1',
  startedAt: 1,
  duration: 1000,
  mime: 'audio/mp4',
  status: 'done',
}

describe('transkript kurtarma', () => {
  beforeEach(async () => {
    await db.recordings.clear()
  })

  it('yarım kalan transkripti yeniden denenebilir hataya çevirir', async () => {
    await db.recordings.add({
      ...doneRecording,
      transcript: { status: 'processing', progress: 44, updatedAt: 2 },
    })

    expect(await recoverInterruptedTranscripts()).toBe(1)
    expect((await db.recordings.get(doneRecording.id))?.transcript).toMatchObject({
      status: 'error',
      error: 'interrupted',
    })
  })

  it('yalnızca işlenen transkripti kurtarır ve tekrar çalıştırıldığında değişiklik yapmaz', async () => {
    const completed: Recording = {
      ...doneRecording,
      id: 'rec-completed',
      transcript: { status: 'done', text: 'Hazır metin', language: 'tr', updatedAt: 3 },
    }
    const failed: Recording = {
      ...doneRecording,
      id: 'rec-failed',
      transcript: { status: 'error', error: 'offline', updatedAt: 4 },
    }
    await db.recordings.bulkAdd([
      completed,
      failed,
      { ...doneRecording, transcript: { status: 'processing', progress: 80, updatedAt: 5 } },
    ])

    expect(await recoverInterruptedTranscripts()).toBe(1)
    expect((await db.recordings.get(completed.id))?.transcript).toEqual(completed.transcript)
    expect((await db.recordings.get(failed.id))?.transcript).toEqual(failed.transcript)
    expect(await recoverInterruptedTranscripts()).toBe(0)
  })
})
