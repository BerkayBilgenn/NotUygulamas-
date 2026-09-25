import { useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Ellipsis,
  Eraser,
  FileMinus2,
  FilePlus2,
  Files,
  GripHorizontal,
  GripVertical,
  Hand,
  Highlighter,
  ImagePlus,
  Circle,
  Lasso,
  Minimize2,
  Minus,
  MoveUpRight,
  Square,
  PenLine,
  Redo2,
  Undo2,
} from 'lucide-react'
import { setSettings, useSettings, type Edge, type ShapeKind, type ToolName } from '../state/settings'
import { useClickOutside, useMedia } from '../ui/hooks'

export const PEN_COLORS = ['#72243E', '#1F1A1C', '#2B59C3', '#C62F4B', '#2E8B57', '#D4537E', '#6B46C1', '#E07B00']
export const HL_COLORS = ['#FFE45C', '#F7A1C4', '#9BE79B', '#9CD3FF', '#FFC27A', '#C9B6FF']
const PEN_SIZES = [2.5, 4, 7]
const HL_SIZES = [14, 22, 32]
const ERASER_SIZES = [8, 14, 28]

export interface PageMenu {
  current: number
  total: number
  onAddAfter: () => void
  onDelete?: () => void
}

interface Props {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onInsertImage: () => void
  pageMenu?: PageMenu
}

type Pop = null | 'palette' | 'pages' | 'more'

const toolLabels: Record<ToolName, string> = { pen: 'Kalem', highlighter: 'Fosforlu kalem', eraser: 'Silgi', shape: 'Şekil', lasso: 'Seç (kement)' }
const shapeIcons: Record<ShapeKind, typeof PenLine> = { line: Minus, arrow: MoveUpRight, rect: Square, ellipse: Circle }
const shapeLabels: Record<ShapeKind, string> = { line: 'Çizgi', arrow: 'Ok', rect: 'Dikdörtgen', ellipse: 'Elips' }
const TOOLS: ToolName[] = ['pen', 'highlighter', 'eraser', 'shape', 'lasso']
const iconFor = (t: ToolName, shape: ShapeKind): typeof PenLine =>
  t === 'shape' ? shapeIcons[shape] : { pen: PenLine, highlighter: Highlighter, eraser: Eraser, lasso: Lasso }[t as Exclude<ToolName, 'shape'>]

export function FloatingToolbar({ canUndo, canRedo, onUndo, onRedo, onInsertImage, pageMenu }: Props) {
  const s = useSettings()
  const [pop, setPop] = useState<Pop>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const dragStart = useRef<{ px: number; py: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useClickOutside(rootRef, () => setPop(null), pop !== null)
  // Phones and short windows: the less-used buttons move into a "more" menu so the pill fits.
  const compact = useMedia('(max-width: 640px), (max-height: 560px)')

  const vertical = s.toolbarEdge === 'left' || s.toolbarEdge === 'right'
  const color = s.tool === 'highlighter' ? s.hlColor : s.penColor
  const toggle = (p: Exclude<Pop, null>) => setPop((cur) => (cur === p ? null : p))

  const pickTool = (t: ToolName) => {
    if (t === 'eraser' && s.tool === 'eraser') {
      setSettings({ eraserMode: s.eraserMode === 'stroke' ? 'pixel' : 'stroke' })
      return
    }
    // Second tap on the shape tool opens the shape picker.
    if (t === 'shape' && s.tool === 'shape') {
      toggle('palette')
      return
    }
    setSettings({ tool: t })
  }

  const onGripDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { px: e.clientX, py: e.clientY }
    setDrag({ x: 0, y: 0 })
  }
  const onGripMove = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return
    setDrag({ x: e.clientX - dragStart.current.px, y: e.clientY - dragStart.current.py })
  }
  const onGripUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current
    dragStart.current = null
    setDrag(null)
    const parent = rootRef.current?.parentElement
    if (!start || !parent) return
    if (Math.hypot(e.clientX - start.px, e.clientY - start.py) < 12) return
    const r = parent.getBoundingClientRect()
    const d: Record<Edge, number> = {
      top: e.clientY - r.top,
      bottom: r.bottom - e.clientY,
      left: e.clientX - r.left,
      right: r.right - e.clientX,
    }
    const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b))
    setSettings({ toolbarEdge: edge })
    setPop(null)
  }

  const sizes = s.tool === 'eraser' ? ERASER_SIZES : s.tool === 'highlighter' ? HL_SIZES : PEN_SIZES
  const currentSize = s.tool === 'eraser' ? s.eraserSize : s.tool === 'highlighter' ? s.hlSize : s.penSize
  const setSize = (v: number) =>
    setSettings(s.tool === 'eraser' ? { eraserSize: v } : s.tool === 'highlighter' ? { hlSize: v } : { penSize: v })
  const colors = s.tool === 'highlighter' ? HL_COLORS : PEN_COLORS
  const setColor = (c: string) => setSettings(s.tool === 'highlighter' ? { hlColor: c } : { penColor: c })
  const ToolIcon = iconFor(s.tool, s.shapeKind)

  const popover = (key: Exclude<Pop, null>, children: ReactNode) => (
    <AnimatePresence>
      {pop === key && (
        <motion.div
          className={`palette palette-${s.toolbarEdge}`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.14 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )

  const pageItems = pageMenu && (
    <>
      <p className="menu-caption">
        Sayfa {pageMenu.current} / {pageMenu.total}
      </p>
      <button
        className="menu-item"
        onClick={() => {
          setPop(null)
          pageMenu.onAddAfter()
        }}
      >
        <FilePlus2 size={18} /> Bu sayfadan sonra boş sayfa ekle
      </button>
      <button
        className="menu-item danger"
        disabled={!pageMenu.onDelete}
        onClick={() => {
          setPop(null)
          pageMenu.onDelete?.()
        }}
      >
        <FileMinus2 size={18} /> Bu sayfayı sil
      </button>
    </>
  )

  const fingerBtn = (
    <button
      className={`tb-btn ${s.fingerDraw ? 'active' : ''}`}
      onClick={() => setSettings({ fingerDraw: !s.fingerDraw })}
      aria-pressed={s.fingerDraw}
      aria-label="Parmakla çiz"
      title={s.fingerDraw ? 'Parmakla çizim açık' : 'Parmak sadece kaydırır'}
    >
      <Hand size={20} />
    </button>
  )

  return (
    <div
      ref={rootRef}
      className={`toolbar-dock edge-${s.toolbarEdge}`}
      style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {s.toolbarCollapsed ? (
          <motion.button
            key="mini"
            className="toolbar-mini"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setSettings({ toolbarCollapsed: false })}
            aria-label={`Araç çubuğunu aç, seçili: ${toolLabels[s.tool]}`}
          >
            <span className="mini-dot" style={{ background: s.tool === 'eraser' || s.tool === 'lasso' ? 'transparent' : color }} />
            <ToolIcon size={18} />
          </motion.button>
        ) : (
          <motion.div
            key="full"
            className={`toolbar ${vertical ? 'vertical' : ''}`}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            role="toolbar"
            aria-label="Çizim araçları"
          >
            <button
              className="tb-grip"
              aria-label="Araç çubuğunu taşı"
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={onGripUp}
            >
              {vertical ? <GripHorizontal size={16} /> : <GripVertical size={16} />}
            </button>

            {TOOLS.map((t) => {
              const Icon = iconFor(t, s.shapeKind)
              return (
                <button
                  key={t}
                  className={`tb-btn ${s.tool === t ? 'active' : ''}`}
                  onClick={() => pickTool(t)}
                  aria-pressed={s.tool === t}
                  aria-label={t === 'eraser' ? `Silgi (${s.eraserMode === 'stroke' ? 'çizgi' : 'piksel'})` : t === 'shape' ? `Şekil (${shapeLabels[s.shapeKind]})` : toolLabels[t]}
                  title={t === 'eraser' && s.tool === 'eraser' ? 'Tekrar dokun: çizgi / piksel silgi' : toolLabels[t]}
                >
                  <Icon size={20} />
                  {t === 'eraser' && s.tool === 'eraser' && <span className="tb-badge">{s.eraserMode === 'stroke' ? 'çizgi' : 'piksel'}</span>}
                </button>
              )
            })}

            <span className="tb-sep" />

            <div className="tb-pop-wrap">
              <button className="tb-btn tb-color" onClick={() => toggle('palette')} aria-label="Renk ve kalınlık" aria-expanded={pop === 'palette'}>
                {s.tool === 'eraser' ? (
                  <span className="size-dot" style={{ width: 8 + currentSize / 2, height: 8 + currentSize / 2 }} />
                ) : (
                  <span className="swatch" style={{ background: color }} />
                )}
              </button>
              {popover(
                'palette',
                <>
                  {s.tool === 'shape' && (
                    <div className="palette-shapes">
                      {(Object.keys(shapeIcons) as ShapeKind[]).map((k) => {
                        const Icon = shapeIcons[k]
                        return (
                          <button
                            key={k}
                            className={`palette-shape ${s.shapeKind === k ? 'active' : ''}`}
                            onClick={() => setSettings({ shapeKind: k })}
                            aria-label={shapeLabels[k]}
                            aria-pressed={s.shapeKind === k}
                          >
                            <Icon size={20} />
                            <span>{shapeLabels[k]}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {s.tool !== 'eraser' && (
                    <div className="palette-colors">
                      {colors.map((c) => (
                        <button
                          key={c}
                          className={`palette-color ${c === color ? 'active' : ''}`}
                          style={{ background: c }}
                          onClick={() => setColor(c)}
                          aria-label={`Renk ${c}`}
                        />
                      ))}
                    </div>
                  )}
                  <div className="palette-sizes">
                    {sizes.map((v) => (
                      <button key={v} className={`palette-size ${v === currentSize ? 'active' : ''}`} onClick={() => setSize(v)} aria-label={`Kalınlık ${v}`}>
                        <span
                          style={{
                            width: Math.min(30, 4 + v * (s.tool === 'highlighter' || s.tool === 'eraser' ? 0.8 : 2.2)),
                            height: Math.min(30, 4 + v * (s.tool === 'highlighter' || s.tool === 'eraser' ? 0.8 : 2.2)),
                            background: s.tool === 'eraser' ? 'transparent' : color,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </>,
              )}
            </div>

            <span className="tb-sep" />

            <button className="tb-btn" onClick={onUndo} disabled={!canUndo} aria-label="Geri al">
              <Undo2 size={20} />
            </button>
            <button className="tb-btn" onClick={onRedo} disabled={!canRedo} aria-label="Yinele">
              <Redo2 size={20} />
            </button>

            <span className="tb-sep" />

            {compact ? (
              <div className="tb-pop-wrap">
                <button className="tb-btn" onClick={() => toggle('more')} aria-label="Diğer araçlar" aria-expanded={pop === 'more'}>
                  <Ellipsis size={20} />
                </button>
                {popover(
                  'more',
                  <div className="menu">
                    <button
                      className={`menu-item ${s.fingerDraw ? 'on' : ''}`}
                      onClick={() => setSettings({ fingerDraw: !s.fingerDraw })}
                      aria-pressed={s.fingerDraw}
                    >
                      <Hand size={18} /> Parmakla çiz: {s.fingerDraw ? 'açık' : 'kapalı'}
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setPop(null)
                        onInsertImage()
                      }}
                    >
                      <ImagePlus size={18} /> Resim ekle
                    </button>
                    {pageItems}
                  </div>,
                )}
              </div>
            ) : (
              <>
                {fingerBtn}
                <button className="tb-btn" onClick={onInsertImage} aria-label="Resim ekle" title="Resim ekle">
                  <ImagePlus size={20} />
                </button>
                {pageMenu && (
                  <div className="tb-pop-wrap">
                    <button className="tb-btn" onClick={() => toggle('pages')} aria-label="Sayfalar" aria-expanded={pop === 'pages'} title="Sayfa ekle / sil">
                      <Files size={20} />
                    </button>
                    {popover('pages', <div className="menu">{pageItems}</div>)}
                  </div>
                )}
              </>
            )}
            <button
              className="tb-btn"
              onClick={() => {
                setPop(null)
                setSettings({ toolbarCollapsed: true })
              }}
              aria-label="Araç çubuğunu küçült"
            >
              <Minimize2 size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
