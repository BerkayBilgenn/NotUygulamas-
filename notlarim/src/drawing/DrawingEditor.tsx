import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { saveDrawing, saveFile, savePdfText } from '../db/repo'
import { seekToWritten, usePlayback } from '../lib/playback'
import type { PdfHit } from '../lib/pdfSearch'
import { PdfSearch } from './PdfSearch'
import { showToast } from '../lib/events'
import { registerFlush } from '../lib/flush'
import { pickFile, prepareImage } from '../lib/files'
import { uid } from '../lib/id'
import { setSettings } from '../state/settings'
import type { NoteMeta, Page } from '../types'
import { DrawingBoard, type BoardApi } from './DrawingBoard'
import { FloatingToolbar } from './FloatingToolbar'
import { PAGE_W } from './render'

const HISTORY_LIMIT = 200

interface EditorProps {
  note: NoteMeta
  search?: { open: boolean; query: string }
  onCloseSearch?: () => void
}

export function DrawingEditor({ note, search, onCloseSearch }: EditorProps) {
  const [pages, setPages] = useState<Page[] | null>(null)
  const pagesRef = useRef<Page[] | null>(null)
  const undoStack = useRef<Page[][]>([])
  const redoStack = useRef<Page[][]>([])
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [scrollTo, setScrollTo] = useState<{ index: number; n: number }>()
  const [current, setCurrent] = useState(0)
  const boardApi = useRef<BoardApi | null>(null)
  const [hits, setHits] = useState<{ list: PdfHit[]; active: number }>({ list: [], active: 0 })
  const [indexing, setIndexing] = useState(false)
  const pdfText = useLiveQuery(() => (note.pdf ? db.pdftext.get(note.id) : undefined), [note.id, note.pdf])
  const playback = usePlayback()

  // PDFs imported before search existed get their text extracted the first time they're opened.
  useEffect(() => {
    if (!note.pdf || pdfText !== undefined) return
    let alive = true
    ;(async () => {
      const row = await db.pdftext.get(note.id)
      if (row || !alive) return
      const d = await db.drawings.get(note.id)
      const fileId = d?.pages.find((p) => p.bg)?.bg?.fileId
      const file = fileId && (await db.files.get(fileId))
      if (!file || !alive) return
      setIndexing(true)
      try {
        const { extractPdfText } = await import('../pdf/pdf')
        const text = await extractPdfText(file.data)
        if (alive) await savePdfText(note.id, text)
      } catch (e) {
        console.warn('[notlarim] PDF text extraction failed', e)
      } finally {
        if (alive) setIndexing(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [note.id, note.pdf, pdfText])

  useEffect(() => {
    let alive = true
    db.drawings.get(note.id).then((d) => {
      if (!alive) return
      const p = d?.pages?.length ? d.pages : [{ id: uid(), strokes: [] }]
      pagesRef.current = p
      setPages(p)
    })
    return () => {
      alive = false
    }
  }, [note.id])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current || !pagesRef.current) return
    dirty.current = false
    await saveDrawing(note.id, pagesRef.current).catch(() => {
      dirty.current = true
    })
  }, [note.id])

  useEffect(() => registerFlush(flush), [flush])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onHide = () => void flush()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  const commit = useCallback(
    (next: Page[]) => {
      pagesRef.current = next
      setPages(next)
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), 700)
      rerender()
    },
    [flush],
  )

  const onChange = useCallback(
    (next: Page[], push: boolean) => {
      const prev = pagesRef.current
      if (push && prev) {
        undoStack.current.push(prev)
        if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
        redoStack.current = []
      }
      commit(next)
    },
    [commit],
  )

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev || !pagesRef.current) return
    redoStack.current.push(pagesRef.current)
    commit(prev)
  }, [commit])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next || !pagesRef.current) return
    undoStack.current.push(pagesRef.current)
    commit(next)
  }, [commit])

  const isPdf = !!note.pdf

  /** Adds a blank page right after the one on screen, same size (so it sits nicely between slides). */
  const addPageAfterCurrent = () => {
    const list = pagesRef.current
    if (!list) return
    const idx = Math.min(current, list.length - 1)
    const ref = list[idx]
    const page: Page = { id: uid(), strokes: [], ...(ref?.h ? { h: ref.h } : {}), ...(isPdf ? { paper: 'lined' as const } : {}) }
    const next = [...list.slice(0, idx + 1), page, ...list.slice(idx + 1)]
    onChange(next, true)
    setScrollTo({ index: idx + 1, n: Date.now() })
  }

  const deleteCurrentPage = () => {
    const list = pagesRef.current
    if (!list || list.length < 2) return
    const idx = Math.min(current, list.length - 1)
    const pg = list[idx]
    const hasContent = pg.strokes.length > 0 || (pg.images?.length ?? 0) > 0 || !!pg.bg
    if (hasContent && !confirm(`${idx + 1}. sayfa silinsin mi? İstersen geri al ile geri getirebilirsin.`)) return
    onChange(
      list.filter((_, i) => i !== idx),
      true,
    )
    showToast(`${idx + 1}. sayfa silindi`, 'info', 2500)
  }

  const insertImage = async () => {
    const file = await pickFile('image/*')
    if (!file) return
    try {
      const img = await prepareImage(file)
      const fileId = await saveFile(note.id, img.data, img.mime, file.name)
      const api = boardApi.current
      const list = pagesRef.current
      if (!api || !list) return
      const t = api.dropTarget()
      const w = Math.min(600, img.width)
      const h = (w * img.height) / img.width
      const maxH = note.drawMode === 'canvas' ? Infinity : t.pageH
      const fit = Math.min(1, (maxH * 0.9) / h)
      const iw = Math.round(w * fit)
      const ih = Math.round(h * fit)
      const x = note.drawMode === 'canvas' ? t.x - iw / 2 : (PAGE_W - iw) / 2
      const y = Math.max(0, Math.min(t.y - ih / 2, maxH - ih))
      const item = { id: uid(), fileId, x, y, w: iw, h: ih }
      const next = list.map((p, i) => (i === t.pageIndex ? { ...p, images: [...(p.images ?? []), item] } : p))
      onChange(next, true)
      // Select it right away so it can be moved or resized.
      setSettings({ tool: 'lasso' })
      requestAnimationFrame(() => boardApi.current?.select(t.pageIndex, [], [item.id]))
    } catch (e) {
      console.error(e)
      showToast('Resim eklenemedi. Başka bir resim dene.', 'error')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const highlights = useMemo(
    () => (search?.open ? hits.list.map((h, i) => ({ pageIndex: h.pageIndex, rects: h.rects, active: i === hits.active })) : undefined),
    [search?.open, hits],
  )
  const rec = playback.rec && playback.rec.noteId === note.id ? playback.rec : null
  const replay = rec ? { from: rec.startedAt, to: rec.startedAt + rec.duration, now: rec.startedAt + playback.currentMs } : undefined
  const onSeekTap = rec && playback.sync ? (t: number) => void seekToWritten(note.id, t) : undefined

  if (!pages) return <div className="loading-note" aria-busy="true" />

  const mode = note.drawMode ?? 'notebook'
  return (
    <div className="drawing-editor">
      <DrawingBoard
        mode={mode}
        paper={note.paper ?? 'lined'}
        pages={pages}
        onChange={onChange}
        onUndo={undo}
        scrollToPage={scrollTo}
        onVisiblePage={setCurrent}
        apiRef={boardApi}
        viewKey={note.id}
        replay={replay}
        onSeekTap={onSeekTap}
        highlights={highlights}
      />
      <FloatingToolbar
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onInsertImage={insertImage}
        pageMenu={
          mode === 'notebook'
            ? {
                current: Math.min(current, pages.length - 1) + 1,
                total: pages.length,
                onAddAfter: addPageAfterCurrent,
                onDelete: pages.length > 1 ? deleteCurrentPage : undefined,
              }
            : undefined
        }
      />
      <AnimatePresence>
        {search?.open && note.pdf && (
          <PdfSearch
            pdf={pdfText}
            indexing={indexing || pdfText === undefined}
            pages={pages}
            initialQuery={search.query}
            onClose={() => onCloseSearch?.()}
            onHits={(list, active) => setHits({ list, active })}
            onJump={(h) => setScrollTo({ index: h.pageIndex, n: Date.now() })}
          />
        )}
      </AnimatePresence>
      {mode === 'notebook' && pages.length > 1 && (
        <div className="page-pill" aria-live="polite">
          {Math.min(current, pages.length - 1) + 1} / {pages.length}
        </div>
      )}
    </div>
  )
}
