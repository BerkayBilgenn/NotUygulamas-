import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { NotebookPen, PenLine } from 'lucide-react'
import { db } from './db/db'
import { createDrawingNote, createPdfNote, createTextNote } from './db/repo'
import { showToast } from './lib/events'
import { pickFile } from './lib/files'
import { recoverRecordings } from './lib/recorder'
import { RecordingPlayer } from './ui/RecordingPlayer'
import { usePersisted } from './state/settings'
import type { DrawMode, NoteType, PaperStyle } from './types'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { useMedia } from './ui/hooks'
import { NoteTopBar } from './ui/NoteTopBar'
import { SettingsSheet } from './ui/SettingsSheet'
import { Sidebar } from './ui/Sidebar'
import { Star, StarField } from './ui/Stars'
import { Toasts } from './ui/Toasts'
import { UpdatePrompt } from './ui/UpdatePrompt'

// Editors load on demand so the list appears faster on first open.
const TextEditor = lazy(() => import('./text/TextEditor').then((m) => ({ default: m.TextEditor })))
const DrawingEditor = lazy(() => import('./drawing/DrawingEditor').then((m) => ({ default: m.DrawingEditor })))

const SIDEBAR_W = 330
const spring = { type: 'spring', stiffness: 380, damping: 36 } as const

export default function App() {
  const notes = useLiveQuery(() => db.notes.toArray(), [])
  const folders = useLiveQuery(() => db.folders.orderBy('createdAt').toArray(), [])

  const [tab, setTab] = usePersisted<NoteType>('tab', 'text')
  const [folderFilter, setFolderFilter] = usePersisted<string>('folder', 'all')
  const [selectedId, setSelectedId] = usePersisted<string | null>('note', null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pdfSearch, setPdfSearch] = useState({ open: false, query: '' })

  // A recording cut off by a crash or a closed tab is turned into a normal recording.
  useEffect(() => {
    recoverRecordings()
      .then((n) => n && showToast(`${n} yarım kalan ses kaydı kurtarıldı`, 'success', 6000))
      .catch(() => {})
  }, [])

  const isWide = useMedia('(min-width: 1024px)')
  const isXL = useMedia('(min-width: 1280px)')

  const selected = notes?.find((n) => n.id === selectedId && !n.deletedAt)
  const showSidebar = !selected || sidebarOpen

  const open = useCallback(
    (id: string) => {
      setSelectedId(id)
      setSidebarOpen(isXL)
      setFocus(false)
      // Opening a PDF from a search result lands on the slide that matched.
      const n = notes?.find((x) => x.id === id)
      setPdfSearch(n?.pdf && query.trim() ? { open: true, query: query.trim() } : { open: false, query: '' })
    },
    [isXL, setSelectedId, notes, query],
  )

  const realFolder = folderFilter !== 'all' && folderFilter !== 'trash' && folders?.some((f) => f.id === folderFilter) ? folderFilter : null

  const newText = async () => open(await createTextNote(realFolder))
  const newDrawing = async (mode: DrawMode, paper: PaperStyle) => open(await createDrawingNote(realFolder, mode, paper))

  const importPdf = async () => {
    const file = await pickFile('application/pdf,.pdf')
    if (!file) return
    showToast(`"${file.name}" hazırlanıyor…`, 'info', 2500)
    try {
      const { readPdfPageSizes } = await import('./pdf/pdf')
      const data = await file.arrayBuffer()
      const sizes = await readPdfPageSizes(data)
      if (!sizes.length) throw new Error('empty')
      open(await createPdfNote(realFolder, file.name, data, sizes))
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error && e.name === 'PdfError' ? e.message : 'Bu PDF açılamadı.'
      showToast(msg, 'error', 7000)
    }
  }

  const changeTab = (t: NoteType) => {
    setTab(t)
    setTagFilter(null)
    if (selected && selected.type !== t) setSelectedId(null)
  }

  // Keep the tab in sync with the open note (e.g. restored from last session).
  useEffect(() => {
    if (selected && selected.type !== tab) setTab(selected.type)
  }, [selected, tab, setTab])

  // Swipe in from the left edge to reveal the list.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (showSidebar) return
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      const isStylus = (t as Touch & { touchType?: string }).touchType === 'stylus'
      swipe.current = e.touches.length === 1 && t.clientX < 22 && !isStylus ? { x: t.clientX, y: t.clientY } : null
    }
    const move = (e: TouchEvent) => {
      const s = swipe.current
      if (!s) return
      const t = e.touches[0]
      if (t.clientX - s.x > 60 && Math.abs(t.clientY - s.y) < 50) {
        swipe.current = null
        setSidebarOpen(true)
      }
    }
    window.addEventListener('touchstart', start, { passive: true, capture: true })
    window.addEventListener('touchmove', move, { passive: true, capture: true })
    return () => {
      window.removeEventListener('touchstart', start, { capture: true })
      window.removeEventListener('touchmove', move, { capture: true })
    }
  }, [showSidebar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (focus) setFocus(false)
        else if (selected && sidebarOpen && !isWide) setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, selected, sidebarOpen, isWide])

  if (!notes || !folders) return <div className="boot" aria-busy="true" />

  const sidebar = (
    <ErrorBoundary title="Not listesi açılamadı">
      <Sidebar
        notes={notes}
        folders={folders}
        tab={tab}
        onTab={changeTab}
        folderFilter={folderFilter}
        onFolder={(f) => {
          setFolderFilter(f)
          setTagFilter(null)
        }}
        tagFilter={tagFilter}
        onTag={setTagFilter}
        query={query}
        onQuery={setQuery}
        selectedId={selected?.id ?? null}
        onOpen={open}
        onNewText={newText}
        onNewDrawing={newDrawing}
        onImportPdf={importPdf}
        onSettings={() => setSettingsOpen(true)}
        onClose={selected && !isWide ? () => setSidebarOpen(false) : undefined}
      />
    </ErrorBoundary>
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className={`app ${isWide ? 'wide' : 'narrow'} ${focus ? 'focus' : ''}`}>
        {isWide ? (
          <motion.aside
            className="sidebar-dock"
            initial={false}
            animate={{ width: showSidebar ? SIDEBAR_W : 0 }}
            transition={spring}
            aria-hidden={!showSidebar}
          >
            <div className="sidebar-inner" style={{ width: SIDEBAR_W }}>
              {sidebar}
            </div>
          </motion.aside>
        ) : (
          <AnimatePresence initial={false}>
            {showSidebar && (
              <>
                {selected && (
                  <motion.div
                    key="backdrop"
                    className="drawer-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setSidebarOpen(false)}
                  />
                )}
                <motion.aside
                  key="drawer"
                  className={`drawer ${selected ? 'over' : 'full'}`}
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={spring}
                >
                  {sidebar}
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        )}

        <main className="main">
          {selected ? (
            <motion.div
              key={selected.id}
              className="note-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            >
              <AnimatePresence initial={false}>
                {!focus && (
                  <NoteTopBar
                    key="bar"
                    note={selected}
                    folders={folders}
                    onMenu={() => setSidebarOpen((o) => !o)}
                    onSearch={selected.pdf ? () => setPdfSearch((s) => ({ open: !s.open, query: '' })) : undefined}
                    onFocus={() => {
                      setFocus(true)
                      setSidebarOpen(false)
                    }}
                  />
                )}
              </AnimatePresence>
              {focus && (
                <motion.button
                  className="focus-exit"
                  onClick={() => setFocus(false)}
                  aria-label="Odak modundan çık"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  whileTap={{ scale: 0.85 }}
                >
                  <Star size={18} color="var(--pink-3)" />
                </motion.button>
              )}
              <div className="note-body">
                <ErrorBoundary key={selected.id} title={selected.type === 'text' ? 'Yazılı not açılamadı' : 'Çizim açılamadı'}>
                  <Suspense fallback={<div className="loading-note" aria-busy="true" />}>
                    {selected.type === 'text' ? (
                      <TextEditor note={selected} />
                    ) : (
                      <DrawingEditor note={selected} search={pdfSearch} onCloseSearch={() => setPdfSearch({ open: false, query: '' })} />
                    )}
                  </Suspense>
                </ErrorBoundary>
              </div>
              <AnimatePresence>
                <RecordingPlayer key="player" noteId={selected.id} />
              </AnimatePresence>
            </motion.div>
          ) : (
            isWide && (
              <div className="empty-main">
                <StarField set="empty" />
                <div className="empty-card">
                  <h2>{tab === 'text' ? 'Bir not seç ya da yenisini başlat' : 'Bir çizim seç ya da yenisini başlat'}</h2>
                  <p className="muted">Her şey bu cihazda saklanır, internet olmadan da çalışır.</p>
                  <div className="empty-actions">
                    <button className="btn primary" onClick={() => (tab === 'text' ? newText() : newDrawing('notebook', 'lined'))}>
                      {tab === 'text' ? <NotebookPen size={18} /> : <PenLine size={18} />}
                      {tab === 'text' ? 'Yeni not' : 'Yeni defter'}
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </main>

        <AnimatePresence>{settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}</AnimatePresence>
        <Toasts />
        <UpdatePrompt />
      </div>
    </MotionConfig>
  )
}
