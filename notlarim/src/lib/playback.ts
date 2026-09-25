import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { Recording } from '../types'
import { showToast } from './events'
import { fileUrl } from './files'

interface State {
  rec: Recording | null
  playing: boolean
  /** Position inside the recording, ms. */
  currentMs: number
  rate: number
  /** "Tap your notes to jump there" mode. */
  sync: boolean
}

let state: State = { rec: null, playing: false, currentMs: 0, rate: 1, sync: true }
const listeners = new Set<() => void>()
let audio: HTMLAudioElement | null = null

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function usePlayback(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
    audio.addEventListener('timeupdate', () => set({ currentMs: (audio?.currentTime ?? 0) * 1000 }))
    audio.addEventListener('play', () => set({ playing: true }))
    audio.addEventListener('pause', () => set({ playing: false }))
    audio.addEventListener('ended', () => set({ playing: false }))
  }
  return audio
}

export async function openRecording(rec: Recording) {
  if (!rec.fileId) return
  const url = await fileUrl(rec.fileId)
  if (!url) {
    showToast('Kayıt dosyası bulunamadı.', 'error')
    return
  }
  const a = el()
  a.pause()
  a.src = url
  a.playbackRate = state.rate
  set({ rec, playing: false, currentMs: 0 })
}

export function closePlayer() {
  audio?.pause()
  set({ rec: null, playing: false, currentMs: 0 })
}

export function togglePlay() {
  const a = el()
  if (a.paused) a.play().catch(() => showToast('Kayıt oynatılamadı.', 'error'))
  else a.pause()
}

export function seekMs(ms: number) {
  const a = el()
  const max = state.rec ? state.rec.duration : Infinity
  a.currentTime = Math.max(0, Math.min(ms, max)) / 1000
  set({ currentMs: a.currentTime * 1000 })
}

export function skip(deltaMs: number) {
  seekMs(state.currentMs + deltaMs)
}

export function cycleRate() {
  const rates = [1, 1.25, 1.5, 2]
  const next = rates[(rates.indexOf(state.rate) + 1) % rates.length]
  el().playbackRate = next
  set({ rate: next })
}

export function setSync(sync: boolean) {
  set({ sync })
}

/**
 * Jumps to the moment something was written (epoch ms). Starts two seconds
 * early so the sentence that led to the note is heard too.
 */
export async function seekToWritten(noteId: string, ts: number) {
  let rec = state.rec
  if (!rec || ts < rec.startedAt || ts > rec.startedAt + rec.duration) {
    const all = await db.recordings.where('noteId').equals(noteId).toArray()
    rec = all.find((r) => r.status === 'done' && ts >= r.startedAt && ts <= r.startedAt + r.duration) ?? null
    if (!rec) {
      showToast('Bu kısım yazılırken kayıt yapılmıyordu.', 'info', 3000)
      return
    }
    await openRecording(rec)
  }
  seekMs(ts - rec.startedAt - 2000)
  el()
    .play()
    .catch(() => {})
}
