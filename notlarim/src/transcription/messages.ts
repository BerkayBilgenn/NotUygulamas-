export type TranscriptionPlatform = 'ios' | 'webgpu'

export type TranscriptionWorkerRequest =
  | {
      type: 'transcribe'
      recId: string
      channels: ArrayBuffer[]
      sampleRate: number
      platform: TranscriptionPlatform
    }
  | { type: 'cancel'; recId: string }

export type TranscriptionWorkerResponse =
  | { type: 'model-progress'; recId: string; progress: number }
  | { type: 'ready'; recId: string }
  | { type: 'transcribe-progress'; recId: string; progress: number }
  | { type: 'complete'; recId: string; text: string; language?: string }
  | { type: 'cancelled'; recId: string }
  | { type: 'error'; recId: string; code: string }
