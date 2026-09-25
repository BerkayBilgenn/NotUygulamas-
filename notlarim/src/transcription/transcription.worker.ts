import { downmixAndResample, mergeTranscriptParts, splitAudio } from './audio'
import type { TranscriptionWorkerRequest, TranscriptionWorkerResponse } from './messages'
import type { ProgressInfo } from '@huggingface/transformers'

export const MODEL_ID = 'onnx-community/whisper-tiny'

interface WorkerScope {
  onmessage: ((event: MessageEvent<TranscriptionWorkerRequest>) => void) | null
  postMessage(message: TranscriptionWorkerResponse): void
}

interface Transcriber {
  (audio: Float32Array, options: { language: string; task: string; return_timestamps: false }): Promise<{ text: string }>
  dispose?: () => Promise<void>
}

const scope = self as unknown as WorkerScope
const cancelled = new Set<string>()

function post(message: TranscriptionWorkerResponse) {
  scope.postMessage(message)
}

function checkCancelled(recId: string) {
  if (cancelled.has(recId)) throw new Error('CANCELLED')
}

async function loadModel(recId: string, device: 'webgpu' | 'wasm'): Promise<Transcriber> {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.allowRemoteModels = true
  const model = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (event: ProgressInfo) => {
      if (event.status === 'progress_total') {
        post({ type: 'model-progress', recId, progress: event.progress })
      }
    },
  })
  return model as unknown as Transcriber
}

async function runWithDevice(
  recId: string,
  channels: Float32Array[],
  sampleRate: number,
  device: 'webgpu' | 'wasm',
): Promise<string> {
  checkCancelled(recId)
  const transcriber = await loadModel(recId, device)
  try {
    checkCancelled(recId)
    post({ type: 'ready', recId })
    const samples = downmixAndResample(channels, sampleRate)
    const segments = splitAudio(samples)
    const parts: string[] = []
    for (const segment of segments) {
      checkCancelled(recId)
      // Copy only the active view so its transferable-sized backing store can be reclaimed after inference.
      const activeSamples = new Float32Array(segment.samples)
      const result = await transcriber(activeSamples, {
        language: 'turkish',
        task: 'transcribe',
        return_timestamps: false,
      })
      parts.push(result.text)
      post({
        type: 'transcribe-progress',
        recId,
        progress: Math.round(((segment.index + 1) / segments.length) * 100),
      })
    }
    return mergeTranscriptParts(parts)
  } finally {
    await transcriber.dispose?.()
  }
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (message.includes('CANCELLED')) return 'CANCELLED'
  if (/out of memory|allocation|memory limit/i.test(message)) return 'OUT_OF_MEMORY'
  if (/fetch|download|network|http|model.*load/i.test(message)) return 'MODEL_DOWNLOAD_FAILED'
  return 'UNKNOWN'
}

async function transcribe(message: Extract<TranscriptionWorkerRequest, { type: 'transcribe' }>) {
  const channels = message.channels.map((buffer) => new Float32Array(buffer))
  try {
    let text: string
    if (message.platform === 'ios') {
      text = await runWithDevice(message.recId, channels, message.sampleRate, 'wasm')
    } else {
      try {
        text = await runWithDevice(message.recId, channels, message.sampleRate, 'webgpu')
      } catch (error) {
        if (errorCode(error) === 'CANCELLED') throw error
        text = await runWithDevice(message.recId, channels, message.sampleRate, 'wasm')
      }
    }
    checkCancelled(message.recId)
    post({ type: 'complete', recId: message.recId, text, language: 'tr' })
  } catch (error) {
    const code = errorCode(error)
    if (code === 'CANCELLED') post({ type: 'cancelled', recId: message.recId })
    else post({ type: 'error', recId: message.recId, code })
  } finally {
    cancelled.delete(message.recId)
  }
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelled.add(message.recId)
    return
  }
  void transcribe(message)
}
