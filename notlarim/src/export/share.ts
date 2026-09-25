/** On iPad opens the share sheet (AirDrop, WhatsApp, Mail, Files, Print); elsewhere downloads. */
export async function shareOrDownload(bytes: Uint8Array, name: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const file = new File([blob], name, { type: mime })
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 20_000)
  return 'downloaded'
}

export function pdfFileName(title: string, fallback: string): string {
  const clean = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${clean || fallback}.pdf`
}
