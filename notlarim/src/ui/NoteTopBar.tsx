import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ellipsis, FileDown, Maximize2, Menu, Search, Trash2 } from 'lucide-react'
import { trashNote, updateNote } from '../db/repo'
import { savedBus, showToast } from '../lib/events'
import { flushAll } from '../lib/flush'
import { RecordControl } from './RecordControl'
import type { Folder, NoteMeta } from '../types'
import { useClickOutside } from './hooks'
import { Sparkle } from './Stars'
import { TagEditor } from './TagEditor'

interface Props {
  note: NoteMeta
  folders: Folder[]
  onMenu: () => void
  onFocus: () => void
  onSearch?: () => void
}

export function NoteTopBar({ note, folders, onMenu, onFocus, onSearch }: Props) {
  const [title, setTitle] = useState(note.title)
  const [moreOpen, setMoreOpen] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const moreRef = useRef<HTMLDivElement>(null)
  useClickOutside(moreRef, () => setMoreOpen(false), moreOpen)

  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail === note.id) setSavedTick((t) => t + 1)
    }
    savedBus.addEventListener('saved', h)
    return () => savedBus.removeEventListener('saved', h)
  }, [note.id])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const [exporting, setExporting] = useState(false)
  const exportPdf = async () => {
    setMoreOpen(false)
    setExporting(true)
    showToast('PDF hazırlanıyor…', 'info', 2500)
    try {
      await flushAll()
      const { exportNotePdf } = await import('../export')
      const res = await exportNotePdf(note)
      if (res === 'downloaded') showToast('PDF indirildi', 'success')
    } catch (e) {
      console.error(e)
      showToast('PDF oluşturulamadı. Tekrar dene.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const onTitle = (v: string) => {
    setTitle(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => updateNote(note.id, { title: v.trim() }), 400)
  }

  return (
    <motion.header
      className="topbar"
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -12, opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button className="icon-btn" onClick={onMenu} aria-label="Notlar listesini aç">
        <Menu size={20} />
      </button>
      <input
        className="title-input"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        onBlur={() => {
          window.clearTimeout(timer.current)
          if (title.trim() !== note.title) updateNote(note.id, { title: title.trim() })
        }}
        placeholder={note.type === 'text' ? 'Başlıksız not' : 'Başlıksız çizim'}
        aria-label="Not başlığı"
        enterKeyHint="done"
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="saved-indicator" aria-live="polite">
        {savedTick > 0 && (
          <motion.span
            key={savedTick}
            initial={{ scale: 0.3, opacity: 0, rotate: -40 }}
            animate={{ scale: [0.3, 1.25, 1], opacity: [0, 1, 0.7], rotate: 0 }}
            transition={{ duration: 0.6 }}
            title="Kaydedildi"
          >
            <Sparkle size={16} color="var(--pink-3)" />
            <span className="sr-only">Kaydedildi</span>
          </motion.span>
        )}
      </span>
      {onSearch && (
        <button className="icon-btn" onClick={onSearch} aria-label="Slaytlarda ara">
          <Search size={19} />
        </button>
      )}
      <RecordControl note={note} />
      <button className="icon-btn" onClick={onFocus} aria-label="Odak modu">
        <Maximize2 size={19} />
      </button>
      <div className="more-wrap" ref={moreRef}>
        <button className="icon-btn" onClick={() => setMoreOpen((o) => !o)} aria-label="Diğer seçenekler" aria-expanded={moreOpen}>
          <Ellipsis size={20} />
        </button>
        <AnimatePresence>
          {moreOpen && (
            <motion.div
              className="popover more-pop"
              initial={{ opacity: 0, scale: 0.94, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <label className="pop-field">
                <span>Klasör</span>
                <select
                  className="input small"
                  value={note.folderId ?? ''}
                  onChange={(e) => updateNote(note.id, { folderId: e.target.value || null })}
                >
                  <option value="">Klasörsüz</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pop-field">
                <span>Etiketler</span>
                <TagEditor tags={note.tags} onChange={(tags) => updateNote(note.id, { tags })} />
              </div>
              <button className="btn full" onClick={exportPdf} disabled={exporting}>
                <FileDown size={17} /> {exporting ? 'PDF hazırlanıyor…' : 'PDF olarak paylaş'}
              </button>
              <button
                className="btn danger full"
                onClick={() => {
                  setMoreOpen(false)
                  trashNote(note.id)
                }}
              >
                <Trash2 size={17} /> Çöp kutusuna taşı
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  )
}
