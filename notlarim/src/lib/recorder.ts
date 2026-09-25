import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { saveFile } from '../db/repo'
import type { Recording } from '../types'
import { showToast } from './events'
import { uid } from './id'

type State =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'recording'; recId: string; noteId: string; startedAt: number }

let state: State = { status: 'idle' }
let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let wakeLock: { release: () => Promise<void> } | null = null
let seq = 0
let writes: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function useRecorder(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** The recording in progress, if any (text and strokes use it for timestamps). */
export function activeRecording(): { startedAt: number } | null {
  return state.status === 'recording' ? state : null
}

export const recordingSupported = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

function pickMime(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? ''
}

export async function startRecording(noteId: string) {
  if (state.status !== 'idle') return
  if (!recordingSupported()) {
    showToast('Bu tarayıcı ses kaydını desteklemiyor.', 'error')
    return
  }
  set({ status: 'starting' })
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    set({ status: 'idle' })
    showToast("Mikrofon izni verilmedi. iPad'de Ayarlar → Safari → Mikrofon'dan izin verebilirsin.", 'error', 8000)
    return
  }
  const mime = pickMime()
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined)
  } catch {
    recorder = new MediaRecorder(stream)
  }
  const rec: Recording = {
    id: uid(),
    noteId,
    fileId: null,
    startedAt: Date.now(),
    duration: 0,
    mime: (recorder.mimeType || mime || 'audio/webm').split(';')[0],
    status: 'recording',
  }
  await db.recordings.add(rec)
  seq = 0
  writes = Promise.resolve()

  recorder.ondataavailable = (e) => {
    if (!e.data.size) return
    const n = seq++
    // Each piece goes to the database right away: if the tab is killed mid-lecture, what was recorded survives.
    writes = writes.then(() =>
      e.data
        .arrayBuffer()
        .then((data) =>
          db.transaction('rw', db.audiochunks, db.recordings, async () => {
            await db.audiochunks.add({ recId: rec.id, seq: n, data })
            await db.recordings.update(rec.id, { lastChunkAt: Date.now() })
          }),
        )
        .catch((err) => console.error('[notlarim] audio chunk not saved', err)),
    )
  }
  recorder.onstop = () => void finishCurrent(rec.id)
  stream.getAudioTracks().forEach((t) =>
    t.addEventListener('ended', () => {
      if (state.status === 'recording') {
        showToast('Kayıt durdu (mikrofon kapandı veya ekran kilitlendi). Kaydedilen kısım saklandı.', 'info', 7000)
        stopRecording()
      }
    }),
  )
  recorder.start(5000)
  set({ status: 'recording', recId: rec.id, noteId, startedAt: rec.startedAt })
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    wakeLock = (await wl?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
}

export function stopRecording() {
  if (state.status !== 'recording' || !recorder) return
  if (recorder.state !== 'inactive') recorder.stop()
  else void finishCurrent(state.recId)
}

async function finishCurrent(recId: string) {
  const endedAt = Date.now()
  await writes
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  recorder = null
  wakeLock?.release().catch(() => {})
  wakeLock = null
  set({ status: 'idle' })
  const rec = await finalizeRecording(recId, endedAt)
  if (rec) showToast(`Kayıt saklandı (${formatDuration(rec.duration)})`, 'success')
}

/** Joins the saved pieces into one audio file. Safe to call again for an unfinished recording. */
export async function finalizeRecording(recId: string, endedAt?: number): Promise<Recording | null> {
  const rec = await db.recordings.get(recId)
  if (!rec || rec.status === 'done') return rec ?? null
  const chunks = await db.audiochunks.where('recId').equals(recId).sortBy('seq')
  if (!chunks.length) {
    await db.recordings.delete(recId)
    return null
  }
  const total = chunks.reduce((n, c) => n + c.data.byteLength, 0)
  const joined = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    joined.set(new Uint8Array(c.data), off)
    off += c.data.byteLength
  }
  const fileId = await saveFile(rec.noteId, joined.buffer, rec.mime, 'ders-kaydi')
  const duration = Math.max(0, (endedAt ?? rec.lastChunkAt ?? rec.startedAt) - rec.startedAt)
  const done: Recording = { ...rec, fileId, duration, status: 'done' }
  await db.transaction('rw', db.recordings, db.audiochunks, async () => {
    await db.recordings.put(done)
    await db.audiochunks.where('recId').equals(recId).delete()
  })
  return done
}

/** On startup: turns recordings interrupted by a crash or a closed tab into normal recordings. */
export async function recoverRecordings(): Promise<number> {
  const open = await db.recordings.where('status').equals('recording').toArray()
  let n = 0
  for (const r of open) {
    if (state.status === 'recording' && state.recId === r.id) continue
    if (await finalizeRecording(r.id)) n++
  }
  return n
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
