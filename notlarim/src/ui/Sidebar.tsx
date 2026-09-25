import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArchiveRestore,
  BookOpenText,
  Check,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Inbox,
  Infinity as InfinityIcon,
  NotebookPen,
  PenLine,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash,
  Trash2,
  X,
} from 'lucide-react'
import { createFolder, deleteFolder, deleteNoteForever, renameFolder, restoreNote } from '../db/repo'
import { matchesQuery, normalizeTr } from '../lib/search'
import { snippetAround } from '../lib/pdfSearch'
import type { DrawMode, Folder, NoteMeta, NoteType, PaperStyle } from '../types'
import { Banners } from './Banners'
import { relativeDate, useClickOutside } from './hooks'
import { NewDrawingPicker } from './NewDrawingPicker'
import { Sparkle, StarField } from './Stars'

interface Props {
  notes: NoteMeta[]
  folders: Folder[]
  tab: NoteType
  onTab: (t: NoteType) => void
  folderFilter: string
  onFolder: (f: string) => void
  tagFilter: string | null
  onTag: (t: string | null) => void
  query: string
  onQuery: (q: string) => void
  selectedId: string | null
  onOpen: (id: string) => void
  onNewText: () => void
  onNewDrawing: (mode: DrawMode, paper: PaperStyle) => void
  onImportPdf: () => void
  onSettings: () => void
  onClose?: () => void
}

const PAPER_LABEL: Record<PaperStyle, string> = { lined: 'çizgili', grid: 'kareli', dots: 'noktalı', blank: 'boş' }

export function Sidebar(p: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  useClickOutside(pickerRef, () => setPickerOpen(false), pickerOpen)

  const folderExists = p.folderFilter === 'all' || p.folderFilter === 'trash' || p.folders.some((f) => f.id === p.folderFilter)
  const folderFilter = folderExists ? p.folderFilter : 'all'
  const inTrash = folderFilter === 'trash'

  const ofType = useMemo(() => p.notes.filter((n) => n.type === p.tab), [p.notes, p.tab])
  const active = useMemo(() => ofType.filter((n) => !n.deletedAt), [ofType])
  const trashed = useMemo(() => ofType.filter((n) => n.deletedAt), [ofType])

  const tags = useMemo(() => {
    const set = new Set<string>()
    active.forEach((n) => n.tags.forEach((t) => set.add(t)))
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'))
  }, [active])

  const list = useMemo(() => {
    let l = inTrash ? trashed : active
    if (!inTrash && folderFilter !== 'all') l = l.filter((n) => n.folderId === folderFilter)
    if (p.tagFilter) l = l.filter((n) => n.tags.includes(p.tagFilter!))
    if (p.query.trim()) l = l.filter((n) => matchesQuery(n, p.query))
    return [...l].sort((a, b) => (inTrash ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0) : b.updatedAt - a.updatedAt))
  }, [inTrash, trashed, active, folderFilter, p.tagFilter, p.query])

  const folderName = (id: string | null) => p.folders.find((f) => f.id === id)?.name

  return (
    <div className="sidebar">
      <StarField set="sidebar" />
      <header className="sb-head">
        <h1 className="wordmark">
          <Sparkle size={20} color="var(--pink-3)" />
          notlarım
        </h1>
        <div className="sb-head-actions">
          <button className="icon-btn" onClick={p.onSettings} aria-label="Ayarlar">
            <Settings size={20} />
          </button>
          {p.onClose && (
            <button className="icon-btn" onClick={p.onClose} aria-label="Listeyi kapat">
              <X size={20} />
            </button>
          )}
        </div>
      </header>

      <div className="segmented" role="tablist" aria-label="Not türü">
        {(['text', 'drawing'] as NoteType[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? 'on' : ''} onClick={() => p.onTab(t)}>
            {p.tab === t && <motion.span layoutId="seg-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <span className="seg-label">
              {t === 'text' ? <NotebookPen size={16} /> : <PenLine size={16} />}
              {t === 'text' ? 'Yazılı' : 'Çizim'}
            </span>
          </button>
        ))}
      </div>

      <Banners notes={p.notes} />

      <div className="sb-actions">
        <div className="search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Notlarda ara"
            aria-label="Notlarda ara"
            enterKeyHint="search"
          />
          {p.query && (
            <button className="icon-btn small" onClick={() => p.onQuery('')} aria-label="Aramayı temizle">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="new-wrap" ref={pickerRef}>
          <motion.button
            className="btn primary new-btn"
            whileTap={{ scale: 0.95 }}
            onClick={() => (p.tab === 'text' ? p.onNewText() : setPickerOpen((o) => !o))}
            aria-expanded={p.tab === 'drawing' ? pickerOpen : undefined}
          >
            <Plus size={19} /> {p.tab === 'text' ? 'Yeni not' : 'Yeni çizim'}
          </motion.button>
          <AnimatePresence>
            {pickerOpen && p.tab === 'drawing' && (
              <NewDrawingPicker
                onPick={(m, paper) => {
                  setPickerOpen(false)
                  p.onNewDrawing(m, paper)
                }}
                onPdf={() => {
                  setPickerOpen(false)
                  p.onImportPdf()
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="sb-scroll">
        <FolderList
          folders={p.folders}
          current={folderFilter}
          onSelect={p.onFolder}
          counts={{
            all: active.length,
            trash: trashed.length,
            byFolder: active.reduce<Record<string, number>>((acc, n) => {
              if (n.folderId) acc[n.folderId] = (acc[n.folderId] ?? 0) + 1
              return acc
            }, {}),
          }}
        />

        {tags.length > 0 && !inTrash && (
          <div className="tag-filter" aria-label="Etiket filtresi">
            {tags.map((t) => (
              <button key={t} className={`chip ${p.tagFilter === t ? 'on' : ''}`} onClick={() => p.onTag(p.tagFilter === t ? null : t)} aria-pressed={p.tagFilter === t}>
                #{t}
              </button>
            ))}
          </div>
        )}

        {inTrash && list.length > 0 && (
          <div className="trash-head">
            <p className="muted small">Çöp kutusundaki notlar sen silene kadar burada kalır.</p>
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm(`${list.length} not kalıcı olarak silinsin mi? Bu geri alınamaz.`)) list.forEach((n) => deleteNoteForever(n.id))
              }}
            >
              Çöpü boşalt
            </button>
          </div>
        )}

        <ul className="note-list">
          <AnimatePresence initial={false}>
            {list.map((n, i) => (
              <motion.li
                key={n.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.025 } }}
                exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
              >
                {inTrash ? (
                  <div className="note-card trashed">
                    <div className="note-card-main">
                      <span className="note-title">{n.title || (n.type === 'text' ? 'Başlıksız not' : 'Başlıksız çizim')}</span>
                      <span className="note-meta">Silindi: {relativeDate(n.deletedAt ?? n.updatedAt)}</span>
                    </div>
                    <div className="note-card-actions">
                      <button className="icon-btn small" onClick={() => restoreNote(n.id)} aria-label="Geri al" title="Geri al">
                        <ArchiveRestore size={17} />
                      </button>
                      <button
                        className="icon-btn small danger"
                        onClick={() => confirm('Bu not kalıcı olarak silinsin mi? Bu geri alınamaz.') && deleteNoteForever(n.id)}
                        aria-label="Kalıcı olarak sil"
                        title="Kalıcı olarak sil"
                      >
                        <Trash size={17} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <motion.button
                    className={`note-card ${p.selectedId === n.id ? 'selected' : ''}`}
                    onClick={() => p.onOpen(n.id)}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="note-title">{n.title || (n.type === 'text' ? 'Başlıksız not' : 'Başlıksız çizim')}</span>
                    {p.query.trim() && <MatchSnippet note={n} query={p.query} />}
                    {p.query.trim() ? null : n.type === 'text' ? (
                      n.searchText.trim() && <span className="note-snippet">{n.searchText.trim().slice(0, 110)}</span>
                    ) : (
                      <span className="note-snippet with-icon">
                        {n.pdf ? <FileText size={14} /> : n.drawMode === 'canvas' ? <InfinityIcon size={14} /> : <BookOpenText size={14} />}
                        {n.pdf
                          ? 'PDF defteri'
                          : `${n.drawMode === 'canvas' ? 'Sonsuz tuval' : 'Defter'}, ${PAPER_LABEL[n.paper ?? 'lined']}`}
                      </span>
                    )}
                    <span className="note-meta">
                      {relativeDate(n.updatedAt)}
                      {folderFilter === 'all' && n.folderId && folderName(n.folderId) && (
                        <span className="note-folder">
                          <FolderIcon size={12} /> {folderName(n.folderId)}
                        </span>
                      )}
                      {n.tags.slice(0, 3).map((t) => (
                        <span key={t} className="note-tag">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </motion.button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {list.length === 0 && (
          <div className="list-empty">
            <Sparkle size={22} color="var(--pink-1)" />
            <p>
              {p.query.trim()
                ? `"${p.query.trim()}" için sonuç yok.`
                : inTrash
                  ? 'Çöp kutusu boş.'
                  : p.tagFilter
                    ? 'Bu etikette not yok.'
                    : p.tab === 'text'
                      ? 'Burada henüz not yok. "Yeni not" ile başla.'
                      : 'Burada henüz çizim yok. "Yeni çizim" ile başla.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function FolderList({
  folders,
  current,
  onSelect,
  counts,
}: {
  folders: Folder[]
  current: string
  onSelect: (id: string) => void
  counts: { all: number; trash: number; byFolder: Record<string, number> }
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = async () => {
    const name = draft.trim()
    if (editing === 'new') {
      if (name) {
        const f = await createFolder(name)
        onSelect(f.id)
      }
    } else if (editing && name) {
      await renameFolder(editing, name)
    }
    setEditing(null)
    setDraft('')
  }

  const editor = (
    <div className="folder-edit">
      <input
        className="input small"
        autoFocus
        value={draft}
        placeholder="Klasör adı"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(null)
        }}
        onBlur={commit}
        enterKeyHint="done"
      />
      <button className="icon-btn small" onPointerDown={(e) => e.preventDefault()} onClick={commit} aria-label="Kaydet">
        <Check size={16} />
      </button>
    </div>
  )

  return (
    <nav className="folders" aria-label="Klasörler">
      <button className={`folder-row ${current === 'all' ? 'on' : ''}`} onClick={() => onSelect('all')}>
        <Inbox size={17} /> <span className="folder-name">Tüm notlar</span> <span className="count">{counts.all}</span>
      </button>
      {folders.map((f) =>
        editing === f.id ? (
          <div key={f.id}>{editor}</div>
        ) : (
          <div key={f.id} className={`folder-row ${current === f.id ? 'on' : ''}`}>
            <button className="folder-main" onClick={() => onSelect(f.id)}>
              <FolderIcon size={17} /> <span className="folder-name">{f.name}</span>
              <span className="count">{counts.byFolder[f.id] ?? 0}</span>
            </button>
            {current === f.id && (
              <span className="folder-tools">
                <button
                  className="icon-btn small"
                  aria-label="Klasörü yeniden adlandır"
                  onClick={() => {
                    setEditing(f.id)
                    setDraft(f.name)
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn small"
                  aria-label="Klasörü sil"
                  onClick={() => {
                    if (confirm(`"${f.name}" klasörü silinsin mi? İçindeki notlar silinmez, "Tüm notlar"da kalır.`)) {
                      deleteFolder(f.id)
                      onSelect('all')
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            )}
          </div>
        ),
      )}
      {editing === 'new' ? (
        editor
      ) : (
        <button
          className="folder-row add"
          onClick={() => {
            setEditing('new')
            setDraft('')
          }}
        >
          <FolderPlus size={17} /> <span className="folder-name">Yeni klasör</span>
        </button>
      )}
      <button className={`folder-row ${current === 'trash' ? 'on' : ''}`} onClick={() => onSelect('trash')}>
        <Trash2 size={17} /> <span className="folder-name">Çöp kutusu</span> {counts.trash > 0 && <span className="count">{counts.trash}</span>}
      </button>
    </nav>
  )
}

/** Shows where the search word appears (in the note text or inside the PDF's slides). */
function MatchSnippet({ note, query }: { note: NoteMeta; query: string }) {
  const token = normalizeTr(query).trim().split(/\s+/)[0]
  if (!token || !normalizeTr(note.searchText).includes(token)) return null
  const s = snippetAround(note.searchText, token, 36)
  return (
    <span className="note-snippet">
      {note.pdf && <b>Slaytlarda: </b>}
      {s.before}
      <mark>{s.match}</mark>
      {s.after}
    </span>
  )
}
