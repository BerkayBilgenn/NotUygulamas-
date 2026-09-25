import { fileBitmap } from '../lib/files'

/**
 * Bitmap caches for the drawing board. The board paints synchronously, so it
 * asks for what it needs and gets whatever is ready; when a missing bitmap
 * arrives, listeners are told to repaint.
 */

const listeners = new Set<() => void>()
export function onAssetReady(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const notify = () => listeners.forEach((l) => l())

// ---------- placed images ----------
const images = new Map<string, ImageBitmap | null | 'loading'>()

export function imageBitmap(fileId: string): ImageBitmap | null {
  const v = images.get(fileId)
  if (v === undefined) {
    images.set(fileId, 'loading')
    fileBitmap(fileId).then((bmp) => {
      images.set(fileId, bmp)
      notify()
    })
    return null
  }
  return v === 'loading' ? null : v
}

// ---------- PDF page backgrounds ----------
// A few fixed resolutions, so zooming doesn't re-render a page for every pinch step.
const TIERS = [700, 1300, 2000, 2800]
export const tierFor = (px: number) => TIERS.find((t) => t >= px) ?? TIERS[TIERS.length - 1]

const MAX_BITMAPS = 14
const pdfCache = new Map<string, { bmp: ImageBitmap; used: number }>()
const pending = new Set<string>()
const queue: { key: string; fileId: string; page: number; tier: number }[] = []
let running = false

const keyOf = (fileId: string, page: number, tier: number) => `${fileId}:${page}:${tier}`

export function pdfBitmap(fileId: string, page: number, tier: number): ImageBitmap | null {
  const key = keyOf(fileId, page, tier)
  const hit = pdfCache.get(key)
  if (hit) {
    hit.used = performance.now()
    return hit.bmp
  }
  request(key, fileId, page, tier)
  // Meanwhile show any other resolution of the same page.
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const other = pdfCache.get(keyOf(fileId, page, TIERS[i]))
    if (other) return other.bmp
  }
  return null
}

function request(key: string, fileId: string, page: number, tier: number) {
  if (pending.has(key)) return
  pending.add(key)
  queue.push({ key, fileId, page, tier })
  // Fast scrolling through a long PDF: forget pages the user already scrolled past.
  while (queue.length > 8) pending.delete(queue.shift()!.key)
  void pump()
}

async function pump() {
  if (running) return
  running = true
  while (queue.length) {
    const job = queue.pop()! // newest first: that's what's on screen now
    try {
      // pdf.js is loaded only when a PDF page is actually on screen.
      const { renderPdfPage } = await import('../pdf/pdf')
      const bmp = await renderPdfPage(job.fileId, job.page, job.tier)
      pdfCache.set(job.key, { bmp, used: performance.now() })
      evict()
      notify()
    } catch (e) {
      console.warn('[notlarim] PDF page render failed', e)
    } finally {
      pending.delete(job.key)
    }
  }
  running = false
}

function evict() {
  while (pdfCache.size > MAX_BITMAPS) {
    let oldestKey = ''
    let oldest = Infinity
    for (const [k, v] of pdfCache) {
      if (v.used < oldest) {
        oldest = v.used
        oldestKey = k
      }
    }
    pdfCache.get(oldestKey)?.bmp.close()
    pdfCache.delete(oldestKey)
  }
}
