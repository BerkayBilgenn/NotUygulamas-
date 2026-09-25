import { db } from '../db/db'

const urlCache = new Map<string, Promise<string | null>>()
const bitmapCache = new Map<string, Promise<ImageBitmap | null>>()

/** Object URL for a stored file (used by images inside text notes). */
export function fileUrl(fileId: string): Promise<string | null> {
  let p = urlCache.get(fileId)
  if (!p) {
    p = db.files.get(fileId).then((f) => {
      if (!f) return null
      const blob = new Blob([f.data], { type: f.mime })
      // Hosted single-file previews may not allow blob: images; a data URL always works there.
      if (import.meta.env.MODE === 'single') {
        return new Promise<string>((res) => {
          const r = new FileReader()
          r.onload = () => res(r.result as string)
          r.readAsDataURL(blob)
        })
      }
      return URL.createObjectURL(blob)
    })
    urlCache.set(fileId, p)
  }
  return p
}

/** Decoded bitmap for a stored image (used when painting drawings). */
export function fileBitmap(fileId: string): Promise<ImageBitmap | null> {
  let p = bitmapCache.get(fileId)
  if (!p) {
    p = db.files
      .get(fileId)
      .then((f) => (f ? createImageBitmap(new Blob([f.data], { type: f.mime })) : null))
      .catch(() => null)
    bitmapCache.set(fileId, p)
  }
  return p
}

export interface PreparedImage {
  data: ArrayBuffer
  mime: string
  width: number
  height: number
}

/**
 * Shrinks photos before storing them: an iPad camera photo is 3-5 MB, a
 * 2000px JPEG is ~400 KB and looks the same on a note page.
 */
export async function prepareImage(file: Blob, maxSide = 2000): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * scale))
  const height = Math.max(1, Math.round(bmp.height * scale))
  const keepOriginal = scale === 1 && file.size < 1.5 * 1024 * 1024 && /^image\/(png|jpeg|webp|gif)$/.test(file.type)
  if (keepOriginal) {
    bmp.close()
    return { data: await file.arrayBuffer(), mime: file.type, width, height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const isPng = file.type === 'image/png'
  if (!isPng) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  const mime = isPng ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), mime, 0.86))
  canvas.width = canvas.height = 0
  return { data: await blob.arrayBuffer(), mime, width, height }
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null)
      input.remove()
    })
    input.addEventListener('cancel', () => {
      resolve(null)
      input.remove()
    })
    input.click()
  })
}
