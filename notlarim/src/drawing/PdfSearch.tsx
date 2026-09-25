import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Search, X } from 'lucide-react'
import { searchPdf, type PdfHit } from '../lib/pdfSearch'
import type { Page, PdfText } from '../types'

interface Props {
  pdf: PdfText | null | undefined
  indexing: boolean
  pages: Page[]
  initialQuery: string
  onClose: () => void
  onHits: (hits: PdfHit[], active: number) => void
  onJump: (hit: PdfHit) => void
}

export function PdfSearch({ pdf, indexing, pages, initialQuery, onClose, onHits, onJump }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (pdf ? searchPdf(pdf, pages, query) : []), [pdf, pages, query])
  const onHitsRef = useRef(onHits)
  onHitsRef.current = onHits
  const onJumpRef = useRef(onJump)
  onJumpRef.current = onJump

  useEffect(() => {
    onHitsRef.current(hits, active)
  }, [hits, active])

  // Jump to the first hit as soon as results appear (e.g. arriving from the sidebar search).
  const firstKey = hits[0] ? `${query}:${hits[0].pageIndex}` : ''
  useEffect(() => {
    if (hits[0]) {
      setActive(0)
      onJumpRef.current(hits[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey])

  useEffect(() => {
    if (!initialQuery) inputRef.current?.focus()
  }, [initialQuery])

  const noText = pdf && pdf.pages.every((p) => !p.t)

  return (
    <motion.div
      className="pdf-search"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="pdf-search-head">
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Slaytlarda ara"
          aria-label="Slaytlarda ara"
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length) {
              const next = (active + 1) % hits.length
              setActive(next)
              onJump(hits[next])
            }
            if (e.key === 'Escape') onClose()
          }}
        />
        <button className="icon-btn small" onClick={onClose} aria-label="Aramayı kapat">
          <X size={16} />
        </button>
      </div>
      <div className="pdf-search-body">
        {indexing && !pdf ? (
          <p className="muted small">Slaytlardaki yazılar hazırlanıyor…</p>
        ) : noText ? (
          <p className="muted small">Bu PDF taranmış (resim) sayfalardan oluşuyor, içinde aranacak yazı yok.</p>
        ) : !query.trim() ? (
          <p className="muted small">Bir kelime yaz, geçtiği slaytları göstereyim. El yazısı notlar aramaya dahil değil.</p>
        ) : hits.length === 0 ? (
          <p className="muted small">"{query.trim()}" hiçbir slaytta geçmiyor.</p>
        ) : (
          <>
            <p className="muted small">{hits.length} slaytta bulundu</p>
            <ul className="pdf-hits">
              {hits.map((h, i) => (
                <li key={h.pageIndex}>
                  <button
                    className={i === active ? 'on' : ''}
                    onClick={() => {
                      setActive(i)
                      onJump(h)
                    }}
                  >
                    <span className="hit-page">Sayfa {h.pageIndex + 1}</span>
                    <span className="hit-snippet">
                      {h.snippet.before}
                      <mark>{h.snippet.match}</mark>
                      {h.snippet.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </motion.div>
  )
}
