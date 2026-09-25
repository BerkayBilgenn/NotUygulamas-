import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { Headphones, Mic, Square, Trash2 } from 'lucide-react'
import { db } from '../db/db'
import { openRecording } from '../lib/playback'
import { formatDuration, recordingSupported, startRecording, stopRecording, useRecorder } from '../lib/recorder'
import type { NoteMeta } from '../types'
import { useClickOutside } from './hooks'
import { RecordingTranscript } from './RecordingTranscript'

export function RecordControl({ note }: { note: NoteMeta }) {
  const r = useRecorder()
  const recs = useLiveQuery(() => db.recordings.where('noteId').equals(note.id).toArray(), [note.id])
  const done = (recs ?? []).filter((x) => x.status === 'done').sort((a, b) => b.startedAt - a.startedAt)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  useEffect(() => {
    if (r.status !== 'recording') return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [r.status])

  if (r.status === 'recording') {
    return (
      <button className="rec-pill" onClick={stopRecording} aria-label="Kaydı durdur">
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-time">{formatDuration(Math.max(0, now - r.startedAt))}</span>
        <Square size={13} fill="currentColor" />
      </button>
    )
  }

  return (
    <div className="more-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Ses kaydı" aria-expanded={open}>
        <Mic size={19} />
        {done.length > 0 && <span className="icon-badge">{done.length}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="popover more-pop rec-pop"
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <button
              className="btn primary full"
              disabled={!recordingSupported() || r.status === 'starting'}
              onClick={() => {
                setOpen(false)
                void startRecording(note.id)
              }}
            >
              <span className="rec-dot light" aria-hidden="true" /> Dersi kaydetmeye başla
            </button>
            <p className="muted small">
              Kayıt sürerken yazdıkların ve çizdiklerin kayda bağlanır; sonra nota dokunup o anı dinleyebilirsin. Ekran kilitlenirse kayıt durur, o
              ana kadarki kısım saklanır.
            </p>
            {done.length > 0 && (
              <ul className="rec-list">
                {done.map((x) => (
                  <li key={x.id}>
                    <div className="rec-row">
                      <button
                        className="rec-item"
                        onClick={() => {
                          setOpen(false)
                          void openRecording(x)
                        }}
                      >
                        <Headphones size={16} />
                        <span>
                          {new Date(x.startedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="muted">{formatDuration(x.duration)}</span>
                      </button>
                      <button
                        className="icon-btn small danger"
                        aria-label="Kaydı sil"
                        onClick={async () => {
                          if (!confirm('Bu ses kaydı silinsin mi? Notun kendisi silinmez.')) return
                          await db.transaction('rw', db.recordings, db.files, async () => {
                            await db.recordings.delete(x.id)
                            if (x.fileId) await db.files.delete(x.fileId)
                          })
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <RecordingTranscript recording={x} noteType={note.type} />
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
