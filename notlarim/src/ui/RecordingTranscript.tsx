import { useState } from 'react'
import { showToast, transcriptInsertBus, type TranscriptInsertDetail } from '../lib/events'
import { cancelTranscription, startTranscription, useTranscriptionJob } from '../transcription/client'
import { transcriptActions } from '../transcription/insert'
import type { NoteType, Recording, TranscriptErrorCode } from '../types'

const errorMessages: Record<TranscriptErrorCode, string> = {
  model: 'Model indirilemedi. İnternet bağlantını kontrol edip tekrar dene.',
  offline: 'Model bu cihazda hazır değil. İnternete bağlanıp bir kez indirmen gerekiyor.',
  decode: 'Bu ses kaydı yazıya çevrilmek üzere açılamadı.',
  memory: 'Cihaz belleği bu kayıt için yetmedi. Diğer sekmeleri kapatıp tekrar dene.',
  cancelled: 'Transkript işlemi iptal edildi.',
  interrupted: 'Transkript işlemi yarıda kaldı. Kaydın güvende; tekrar deneyebilirsin.',
  unknown: 'Transkript oluşturulamadı. Kaydın güvende; tekrar deneyebilirsin.',
}

export function RecordingTranscript({ recording, noteType }: { recording: Recording; noteType: NoteType }) {
  const job = useTranscriptionJob()
  const [inserting, setInserting] = useState(false)
  const transcript = recording.transcript
  const active = job.recId === recording.id

  const begin = async (replace = false) => {
    if (replace && !confirm('Mevcut transkript yenisiyle değiştirilsin mi?')) return
    try {
      await startTranscription(recording)
    } catch (error) {
      if (error instanceof Error && error.message === 'TRANSCRIPTION_BUSY') {
        showToast('Önce devam eden transkript işleminin bitmesini bekle.', 'info')
      }
    }
  }

  if (!transcript) {
    return (
      <div className="transcript-panel">
        <button className="transcript-action primary" onClick={() => void begin()}>
          Transkript oluştur
        </button>
        <span className="transcript-hint">İlk kullanımda yaklaşık 60–100 MB model indirilir; ses cihazından çıkmaz.</span>
      </div>
    )
  }

  if (transcript.status === 'processing') {
    const progress = active ? job.progress : transcript.progress
    const label = active && job.phase === 'preparing'
      ? 'Ses hazırlanıyor'
      : active && job.phase === 'model'
        ? `Model indiriliyor · %${progress}`
        : `Yazıya çevriliyor · %${progress}`
    return (
      <div className="transcript-panel transcript-processing" aria-live="polite">
        <span>{label}</span>
        <div className="transcript-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        {active && <button className="transcript-action danger" onClick={() => cancelTranscription(recording.id)}>İptal</button>}
      </div>
    )
  }

  if (transcript.status === 'error') {
    return (
      <div className="transcript-panel" role="status">
        <p className="transcript-error">{errorMessages[transcript.error]}</p>
        <button className="transcript-action" onClick={() => void begin()}>Tekrar dene</button>
      </div>
    )
  }

  const actions = transcriptActions(noteType, transcript)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcript.text)
      showToast('Transkript kopyalandı.', 'success')
    } catch {
      showToast('Transkript kopyalanamadı.', 'error')
    }
  }
  const insert = () => {
    if (inserting) return
    setInserting(true)
    const detail: TranscriptInsertDetail = {
      noteId: recording.noteId,
      text: transcript.text,
      startedAt: recording.startedAt,
    }
    transcriptInsertBus.dispatchEvent(new CustomEvent('insert', { detail }))
    showToast('Transkript nota eklendi.', 'success')
    window.setTimeout(() => setInserting(false), 400)
  }

  return (
    <div className="transcript-panel transcript-done">
      <details>
        <summary>Transkripti göster</summary>
        <p>{transcript.text}</p>
      </details>
      <div className="transcript-actions">
        {actions.includes('copy') && <button className="transcript-action" onClick={() => void copy()}>Kopyala</button>}
        {actions.includes('insert') && <button className="transcript-action primary" disabled={inserting} onClick={insert}>Nota ekle</button>}
        {actions.includes('retry') && <button className="transcript-action" onClick={() => void begin(true)}>Yeniden oluştur</button>}
      </div>
    </div>
  )
}
