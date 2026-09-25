import { setMeta } from '../db/repo'
import { showToast } from './events'
import { BackupError, backupFileName, buildBackup, parseBackup, restoreBackup } from './backup'

/** Saves a backup file. On iPad this opens the share sheet so it can go to Files / iCloud Drive. */
export async function exportBackup(): Promise<boolean> {
  try {
    const data = await buildBackup()
    const name = backupFileName()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const file = new File([blob], name, { type: 'application/json' })
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (coarse && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'notlarım yedeği' })
      } catch (e) {
        if ((e as Error).name === 'AbortError') return false
        downloadBlob(blob, name)
      }
    } else {
      downloadBlob(blob, name)
    }
    await setMeta('lastBackupAt', Date.now())
    showToast(`Yedek hazır: ${data.data.notes.length} not`, 'success')
    return true
  } catch (e) {
    console.error(e)
    showToast('Yedek oluşturulamadı. Tekrar dene.', 'error')
    return false
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function importBackupFile(file: File) {
  try {
    const parsed = parseBackup(await file.text())
    const r = await restoreBackup(parsed)
    const parts = [`${r.added} not eklendi`]
    if (r.updated) parts.push(`${r.updated} not güncellendi`)
    if (r.keptNewer) parts.push(`${r.keptNewer} not cihazdaki daha yeni sürümüyle korundu`)
    showToast(parts.join(', ') + '.', 'success', 7000)
  } catch (e) {
    if (e instanceof BackupError) showToast(e.message, 'error', 8000)
    else {
      console.error(e)
      showToast('Yedek yüklenemedi. Mevcut notlarına dokunulmadı.', 'error', 8000)
    }
  }
}
