import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { Recording, TranscriptErrorCode } from '../types'
import type { TranscriptionPlatform, TranscriptionWorkerRequest, TranscriptionWorkerResponse } from './messages'

export interface TranscriptionWorker {
  onmessage: ((event: MessageEvent<TranscriptionWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TranscriptionWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

interface DecodedAudio {
  sampleRate: number
  channels: Float32Array[]
}

export interface TranscriptionClientOptions {
  createWorker?: () => TranscriptionWorker
  decodeAudio?: (data: ArrayBuffer) => Promise<DecodedAudio>
  isOnline?: () => boolean
  now?: () => number
}

export interface TranscriptionJobState {
  recId: string | null
  phase: 'idle' | 'preparing' | 'model' | 'transcribing'
  progress: number
}

const idleState: TranscriptionJobState = { recId: null, phase: 'idle', progress: 0 }
let jobState = idleState
const listeners = new Set<() => void>()

function setJobState(next: TranscriptionJobState) {
  jobState = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTranscriptionJob(): TranscriptionJobState {
  return useSyncExternalStore(subscribe, () => jobState, () => idleState)
}

interface ActiveJob {
  recId: string
  cancel: () => void
}

let activeJob: ActiveJob | null = null

function defaultWorker(): TranscriptionWorker {
  return new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' }) as TranscriptionWorker
}

async function defaultDecodeAudio(data: ArrayBuffer): Promise<DecodedAudio> {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(data.slice(0))
    return {
      sampleRate: audio.sampleRate,
      channels: Array.from({ length: audio.numberOfChannels }, (_, index) => new Float32Array(audio.getChannelData(index))),
    }
  } finally {
    await context.close()
  }
}

interface NavigatorIdentity {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}

export function detectTranscriptionPlatform(identity: NavigatorIdentity): TranscriptionPlatform {
  const iPadDesktopMode = identity.platform === 'MacIntel' && (identity.maxTouchPoints ?? 0) > 1
  return /iPad|iPhone|iPod/.test(identity.userAgent) || iPadDesktopMode ? 'ios' : 'webgpu'
}

function platform(): TranscriptionPlatform {
  return detectTranscriptionPlatform(typeof navigator === 'undefined'
    ? { userAgent: '' }
    : navigator)
}

function mapError(code: string, isOnline: () => boolean): TranscriptErrorCode {
  if (code === 'MODEL_DOWNLOAD_FAILED') return isOnline() ? 'model' : 'offline'
  if (code === 'AUDIO_DECODE_FAILED') return 'decode'
  if (code === 'OUT_OF_MEMORY') return 'memory'
  if (code === 'CANCELLED') return 'cancelled'
  return 'unknown'
}

export function startTranscription(recording: Recording, options: TranscriptionClientOptions = {}): Promise<void> {
  if (activeJob) return Promise.reject(new Error('TRANSCRIPTION_BUSY'))

  const createWorker = options.createWorker ?? defaultWorker
  const decodeAudio = options.decodeAudio ?? defaultDecodeAudio
  const isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine)
  const now = options.now ?? Date.now
  const worker = createWorker()
  let settled = false
  let lastProgressWrite = -Infinity
  let writes = Promise.resolve()
  let resolveJob: () => void
  let rejectJob: (error: Error) => void

  const writeTranscript = (transcript: Recording['transcript']) => {
    writes = writes.then(async () => {
      await db.recordings.update(recording.id, { transcript })
    })
    return writes
  }

  const fail = async (code: string) => {
    if (settled) return
    settled = true
    await writeTranscript({ status: 'error', error: mapError(code, isOnline), updatedAt: now() })
    rejectJob(new Error(code))
  }

  const complete = async (message: Extract<TranscriptionWorkerResponse, { type: 'complete' }>) => {
    if (settled) return
    settled = true
    await writeTranscript({
      status: 'done',
      text: message.text.trim(),
      language: message.language,
      updatedAt: now(),
    })
    resolveJob()
  }

  const promise = new Promise<void>((resolve, reject) => {
    resolveJob = resolve
    rejectJob = reject

    worker.onmessage = (event) => {
      const message = event.data
      if (message.recId !== recording.id || settled) return
      if (message.type === 'complete') {
        void complete(message)
        return
      }
      if (message.type === 'error') {
        void fail(message.code)
        return
      }
      if (message.type === 'cancelled') {
        void fail('CANCELLED')
        return
      }
      if (message.type === 'ready') {
        setJobState({ recId: recording.id, phase: 'transcribing', progress: 0 })
        return
      }

      const progress = Math.max(0, Math.min(100, Math.round(message.progress)))
      setJobState({
        recId: recording.id,
        phase: message.type === 'model-progress' ? 'model' : 'transcribing',
        progress,
      })
      const timestamp = now()
      if (timestamp - lastProgressWrite >= 1000) {
        lastProgressWrite = timestamp
        void writeTranscript({ status: 'processing', progress, updatedAt: timestamp })
      }
    }

    worker.onerror = () => {
      void fail('UNKNOWN')
    }

    void (async () => {
      try {
        await writeTranscript({ status: 'processing', progress: 0, updatedAt: now() })
        const storedFile = recording.fileId ? await db.files.get(recording.fileId) : undefined
        if (!storedFile) throw new Error('AUDIO_DECODE_FAILED')
        const decoded = await decodeAudio(storedFile.data)
        if (settled) return
        const channels = decoded.channels.map((channel) => new Float32Array(channel).buffer as ArrayBuffer)
        worker.postMessage(
          { type: 'transcribe', recId: recording.id, channels, sampleRate: decoded.sampleRate, platform: platform() },
          channels,
        )
      } catch (error) {
        const code = error instanceof Error && error.message === 'AUDIO_DECODE_FAILED' ? error.message : 'AUDIO_DECODE_FAILED'
        await fail(code)
      }
    })()
  })

  activeJob = {
    recId: recording.id,
    cancel: () => {
      if (settled) return
      worker.postMessage({ type: 'cancel', recId: recording.id })
      void fail('CANCELLED')
    },
  }
  setJobState({ recId: recording.id, phase: 'preparing', progress: 0 })

  return promise.finally(() => {
    worker.terminate()
    worker.onmessage = null
    worker.onerror = null
    if (activeJob?.recId === recording.id) activeJob = null
    setJobState(idleState)
  })
}

export function cancelTranscription(recId: string): void {
  if (activeJob?.recId === recId) activeJob.cancel()
}
