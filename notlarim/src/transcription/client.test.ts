import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import type { Recording } from '../types'
import {
  cancelTranscription,
  detectTranscriptionPlatform,
  startTranscription,
  type TranscriptionClientOptions,
  type TranscriptionWorker,
} from './client'

type WorkerMessage = { type: string; recId: string; [key: string]: unknown }

class FakeWorker implements TranscriptionWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: WorkerMessage[] = []
  transferList: Transferable[] = []
  terminated = false
  onPost?: (message: WorkerMessage) => void

  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    this.posted.push(message)
    this.transferList.push(...transfer)
    this.onPost?.(message)
  }

  emit(data: WorkerMessage) {
    this.onmessage?.({ data } as MessageEvent)
  }

  terminate() {
    this.terminated = true
  }
}

const r1: Recording = {
  id: 'recording-1', noteId: 'note-1', fileId: 'file-1', startedAt: 1,
  duration: 1000, mime: 'audio/mp4', status: 'done',
}
const r2: Recording = { ...r1, id: 'recording-2', fileId: 'file-2' }

const decoded = {
  sampleRate: 48_000,
  channels: [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])],
}

function options(worker: FakeWorker): TranscriptionClientOptions {
  return { createWorker: () => worker, decodeAudio: async () => decoded }
}

async function waitUntilPosted(worker: FakeWorker) {
  await vi.waitFor(() => expect(worker.posted.some((message) => message.type === 'transcribe')).toBe(true))
}

describe('transkripsiyon istemcisi', () => {
  beforeEach(async () => {
    await Promise.all([db.recordings.clear(), db.files.clear()])
    await db.recordings.bulkAdd([r1, r2])
    await db.files.bulkAdd([
      { id: 'file-1', noteId: 'note-1', mime: 'audio/mp4', createdAt: 1, data: new ArrayBuffer(8) },
      { id: 'file-2', noteId: 'note-1', mime: 'audio/mp4', createdAt: 1, data: new ArrayBuffer(8) },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('masaüstü kimliği kullanan iPadOS cihazını WASM yolu olarak tanır', () => {
    expect(detectTranscriptionPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe('ios')
  })

  it('ikinci eşzamanlı işi reddeder', async () => {
    const worker = new FakeWorker()
    const first = startTranscription(r1, options(worker))

    await expect(startTranscription(r2, options(new FakeWorker()))).rejects.toThrow('TRANSCRIPTION_BUSY')
    await waitUntilPosted(worker)
    worker.emit({ type: 'complete', recId: r1.id, text: 'tamam', language: 'tr' })

    await expect(first).resolves.toBeUndefined()
    expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'done', text: 'tamam' })
  })

  it('model çevrimdışı ve önbelleksizse kaydı koruyup offline hatası yazar', async () => {
    const worker = new FakeWorker()
    worker.onPost = (message) => {
      if (message.type === 'transcribe') worker.emit({ type: 'error', recId: r1.id, code: 'MODEL_DOWNLOAD_FAILED' })
    }

    const job = startTranscription(r1, { ...options(worker), isOnline: () => false })

    await expect(job).rejects.toThrow('MODEL_DOWNLOAD_FAILED')
    expect((await db.recordings.get(r1.id))?.fileId).toBe(r1.fileId)
    expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'error', error: 'offline' })
  })

  it('kanal tamponlarını Worker aktarım listesine verir', async () => {
    const worker = new FakeWorker()
    worker.onPost = (message) => {
      if (message.type === 'transcribe') worker.emit({ type: 'complete', recId: r1.id, text: 'tamam' })
    }

    await startTranscription(r1, options(worker))

    expect(worker.transferList).toEqual(expect.arrayContaining([expect.any(ArrayBuffer)]))
  })

  it('ilerlemeyi kaydeder ve tamamlanınca workerı kapatır', async () => {
    const worker = new FakeWorker()
    const job = startTranscription(r1, options(worker))
    await waitUntilPosted(worker)

    worker.emit({ type: 'transcribe-progress', recId: r1.id, progress: 37 })
    await vi.waitFor(async () => expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'processing', progress: 37 }))
    worker.emit({ type: 'complete', recId: r1.id, text: 'ders metni' })

    await job
    expect(worker.terminated).toBe(true)
  })

  it('aktif işi iptal eder ve kaydı yeniden denenebilir bırakır', async () => {
    const worker = new FakeWorker()
    const job = startTranscription(r1, options(worker))
    await waitUntilPosted(worker)

    cancelTranscription(r1.id)

    await expect(job).rejects.toThrow('CANCELLED')
    expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'error', error: 'cancelled' })
    expect(worker.terminated).toBe(true)
  })

  it('WebGPU hatasında yeni Worker ile WASM olarak bir kez baştan dener', async () => {
    const gpuWorker = new FakeWorker()
    const wasmWorker = new FakeWorker()
    const workers = [gpuWorker, wasmWorker]
    const createWorker = () => workers.shift()!
    gpuWorker.onPost = (message) => {
      if (message.type === 'transcribe') gpuWorker.emit({ type: 'error', recId: r1.id, code: 'WEBGPU_FAILED' })
    }
    wasmWorker.onPost = (message) => {
      if (message.type === 'transcribe') wasmWorker.emit({ type: 'complete', recId: r1.id, text: 'WASM sonucu' })
    }

    await startTranscription(r1, { createWorker, decodeAudio: async () => decoded })

    expect(gpuWorker.terminated).toBe(true)
    expect(wasmWorker.posted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'transcribe', platform: 'wasm' }),
    ]))
    expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'done', text: 'WASM sonucu' })
  })

  it('IndexedDB yazımı reddedilirse işi serbest bırakıp sonraki kayda izin verir', async () => {
    vi.spyOn(db.recordings, 'update').mockRejectedValueOnce(new Error('quota'))
    const failed = startTranscription(r1, options(new FakeWorker()))
    const outcome = await Promise.race([
      failed.then(() => 'resolved', () => 'rejected'),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 80)),
    ])

    expect(outcome).toBe('rejected')

    const nextWorker = new FakeWorker()
    nextWorker.onPost = (message) => {
      if (message.type === 'transcribe') nextWorker.emit({ type: 'complete', recId: r2.id, text: 'sonraki iş' })
    }
    await expect(startTranscription(r2, options(nextWorker))).resolves.toBeUndefined()
  })
})
