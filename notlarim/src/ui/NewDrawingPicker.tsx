import { motion } from 'motion/react'
import { BookOpenText, FileUp, Infinity as InfinityIcon } from 'lucide-react'
import type { DrawMode, PaperStyle } from '../types'

const NOTEBOOK: { paper: PaperStyle; label: string }[] = [
  { paper: 'lined', label: 'Çizgili' },
  { paper: 'grid', label: 'Kareli' },
  { paper: 'dots', label: 'Noktalı' },
  { paper: 'blank', label: 'Boş' },
]
const CANVAS: { paper: PaperStyle; label: string }[] = [
  { paper: 'grid', label: 'Kareli' },
  { paper: 'dots', label: 'Noktalı' },
  { paper: 'blank', label: 'Boş' },
]

function PaperThumb({ paper }: { paper: PaperStyle }) {
  return <span className={`paper-thumb paper-${paper}`} aria-hidden="true" />
}

export function NewDrawingPicker({ onPick, onPdf }: { onPick: (mode: DrawMode, paper: PaperStyle) => void; onPdf: () => void }) {
  return (
    <motion.div
      className="popover picker-pop"
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -6 }}
      transition={{ duration: 0.15 }}
    >
      <button className="picker-pdf" onClick={onPdf}>
        <FileUp size={22} />
        <span>
          <b>PDF aç</b>
          <small>Ders slaytlarının üzerine yaz</small>
        </span>
      </button>
      <div className="picker-group">
        <h4>
          <BookOpenText size={16} /> Defter
        </h4>
        <p className="muted small">Sayfa sayfa, A4 oranında</p>
        <div className="picker-options">
          {NOTEBOOK.map((o) => (
            <button key={o.paper} className="picker-option" onClick={() => onPick('notebook', o.paper)}>
              <PaperThumb paper={o.paper} />
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="picker-group">
        <h4>
          <InfinityIcon size={16} /> Sonsuz tuval
        </h4>
        <p className="muted small">Her yöne kaydırılan alan</p>
        <div className="picker-options">
          {CANVAS.map((o) => (
            <button key={o.paper} className="picker-option" onClick={() => onPick('canvas', o.paper)}>
              <PaperThumb paper={o.paper} />
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
