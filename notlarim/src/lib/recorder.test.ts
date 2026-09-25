import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { finalizeRecording, formatDuration, recoverRecordings } from './recorder'

beforeEach(async () => {
  await Promise.all([db.recordings.clear(), db.audiochunks.clear(), db.files.clear()])
})

async function seedInterrupted(id: string) {
  await db.recordings.add({ id, noteId: 'n1', fileId: null, startedAt: 1_000, duration: 0, mime: 'audio/mp4', status: 'recording', lastChunkAt: 61_000 })
  // Pieces saved out of order must still be joined in order.
  await db.audiochunks.bulkAdd([
    { recId: id, seq: 1, data: new Uint8Array([4, 5, 6]).buffer },
    { recId: id, seq: 0, data: new Uint8Array([1, 2, 3]).buffer },
    { recId: id, seq: 2, data: new Uint8Array([7]).buffer },
  ])
}

describe('ses kaydı', () => {
  it('parçaları sırayla tek dosyada birleştirir ve parçaları siler', async () => {
    await seedInterrupted('r1')
    const rec = await finalizeRecording('r1', 31_000)
    expect(rec?.status).toBe('done')
    expect(rec?.duration).toBe(30_000)
    const file = await db.files.get(rec!.fileId!)
    expect(Array.from(new Uint8Array(file!.data))).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(await db.audiochunks.count()).toBe(0)
  })

  it('uygulama kapanınca yarım kalan kaydı açılışta kurtarır', async () => {
    await seedInterrupted('r2')
    expect(await recoverRecordings()).toBe(1)
    const rec = await db.recordings.get('r2')
    expect(rec?.status).toBe('done')
    expect(rec?.duration).toBe(60_000)
  })

  it('hiç ses gelmemiş kaydı iz bırakmadan siler', async () => {
    await db.recordings.add({ id: 'r3', noteId: 'n1', fileId: null, startedAt: 1, duration: 0, mime: 'audio/mp4', status: 'recording' })
    expect(await finalizeRecording('r3')).toBeNull()
    expect(await db.recordings.get('r3')).toBeUndefined()
  })

  it('süreyi okunur yazar', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})
