import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent, RefObject } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import type { DrawMode, ImageItem, Page, PaperStyle, Point, Stroke } from '../types'
import { getSettings, useSettings } from '../state/settings'
import { uid } from '../lib/id'
import { erasePixels, eraseStrokes } from '../lib/eraser'
import { onAssetReady, pdfBitmap, tierFor } from './assetCache'
import {
  PAGE_H,
  PAGE_W,
  PAPER_COLOR,
  layoutPages,
  pageH,
  paintImages,
  paintLiveStroke,
  paintPaper,
  paintStrokes,
  strokeBounds,
} from './render'
import { pointInPolygon } from './geometry'
import { shapeStrokes, snapEnd, type ShapeKind } from './shapes'
import { strokeHit } from '../lib/eraser'

export interface BoardApi {
  /** Page under the middle of the screen and a point on it, for placing new images. */
  dropTarget(): { pageIndex: number; x: number; y: number; pageH: number }
  select(pageIndex: number, strokeIds: string[], imageIds: string[]): void
}

interface Props {
  mode: DrawMode
  paper: PaperStyle
  pages: Page[]
  onChange: (pages: Page[], pushHistory: boolean) => void
  onUndo: () => void
  scrollToPage?: { index: number; n: number }
  onVisiblePage?: (index: number) => void
  apiRef?: RefObject<BoardApi | null>
  /** Remembers zoom and scroll position per note across visits. */
  viewKey?: string
  /** Audio replay: strokes written after `now` (within the recording) are dimmed. */
  replay?: { from: number; to: number; now: number }
  /** When set, taps jump the recording to the tapped stroke instead of drawing. */
  onSeekTap?: (t: number) => void
  /** Search hits to mark on PDF pages (rects in page units). */
  highlights?: { pageIndex: number; rects: [number, number, number, number][]; active: boolean }[]
}

interface View {
  ox: number
  oy: number
  scale: number
}
interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface Selection {
  pageIndex: number
  strokeIds: Set<string>
  imageIds: Set<string>
  box: Box
}
interface Active {
  pointerId: number
  pointerType: string
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; v: View }
  | { kind: 'pinch'; dist: number; mx: number; my: number; v: View }

const SIDE = 6
const TOP_PAD = 10
const BOTTOM_PAD = 140
const MAX_PAGE_PX = 1200
const HANDLE_R = 24

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function boxOf(page: Page, strokeIds: Set<string>, imageIds: Set<string>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of page.strokes) {
    if (!strokeIds.has(s.id)) continue
    const b = strokeBounds(s)
    x0 = Math.min(x0, b.x0)
    y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1)
    y1 = Math.max(y1, b.y1)
  }
  for (const im of page.images ?? []) {
    if (!imageIds.has(im.id)) continue
    x0 = Math.min(x0, im.x)
    y0 = Math.min(y0, im.y)
    x1 = Math.max(x1, im.x + im.w)
    y1 = Math.max(y1, im.y + im.h)
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

export function DrawingBoard({ mode, paper, pages, onChange, onUndo, scrollToPage, onVisiblePage, apiRef, viewKey, replay, onSeekTap, highlights }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const { tool, toolbarEdge, toolbarCollapsed } = useSettings()

  // Everything the event handlers touch lives in refs so drawing never waits on React renders.
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const modeRef = useRef(mode)
  modeRef.current = mode
  const paperRef = useRef(paper)
  paperRef.current = paper
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onUndoRef = useRef(onUndo)
  onUndoRef.current = onUndo
  const onVisibleRef = useRef(onVisiblePage)
  onVisibleRef.current = onVisiblePage
  const replayRef = useRef(replay)
  replayRef.current = replay
  const seekRef = useRef(onSeekTap)
  seekRef.current = onSeekTap
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights
  const seekTap = useRef<null | (Active & { sx: number; sy: number; at: number })>(null)

  const view = useRef<View>({ ox: 0, oy: 0, scale: 1 })
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const fitted = useRef(false)
  const zoomRel = useRef(1)
  const frame = useRef({ base: 0, live: 0 })
  const layout = useRef<{ pages: Page[] | null; tops: number[]; total: number }>({ pages: null, tops: [], total: 0 })
  const lastVisible = useRef(-1)

  const drawing = useRef<null | (Active & { pageIndex: number; stroke: Stroke; shape?: { kind: ShapeKind; a: [number, number]; b: [number, number] } })>(null)
  const erasing = useRef<null | (Active & { changed: boolean; last: { x: number; y: number } | null; cursor: { sx: number; sy: number } | null })>(null)
  const lasso = useRef<null | (Active & { pageIndex: number; pts: [number, number][] })>(null)
  const sel = useRef<Selection | null>(null)
  const drag = useRef<null | (Active & { mode: 'move' | 'scale'; sx: number; sy: number; tx: number; ty: number; s: number })>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const tap = useRef({ start: 0, max: 0, moved: 0 })
  const [selUi, setSelUi] = useState<null | { left: number; top: number; width: number; height: number }>(null)

  const active = (): Active | null => drawing.current ?? erasing.current ?? lasso.current ?? drag.current ?? seekTap.current

  // ---------- layout ----------
  const getLayout = () => {
    if (layout.current.pages !== pagesRef.current) {
      layout.current = { pages: pagesRef.current, ...layoutPages(pagesRef.current) }
    }
    return layout.current
  }
  const notebook = () => modeRef.current === 'notebook'
  const topOf = (i: number) => (notebook() ? (getLayout().tops[i] ?? 0) : 0)
  const heightOf = (i: number) => (notebook() ? pageH(pagesRef.current[i]) : Infinity)
  const contentHeight = () => getLayout().total
  // Leave room under a top-docked toolbar so it doesn't cover a slide's title at rest.
  const topPad = () => {
    const st = getSettings()
    return notebook() && st.toolbarEdge === 'top' && !st.toolbarCollapsed ? 64 : TOP_PAD
  }
  const fitScale = () => Math.max(0.05, Math.min(size.current.w - SIDE * 2, MAX_PAGE_PX) / PAGE_W)
  const scaleLimits = (): [number, number] => {
    if (notebook()) {
      const f = fitScale()
      return [f * 0.35, f * 6]
    }
    return [0.12, 6]
  }
  const clampView = (v: View): View => {
    if (!notebook()) return v
    const { w, h } = size.current
    const cw = PAGE_W * v.scale
    const ch = contentHeight() * v.scale
    let { ox, oy } = v
    ox = cw <= w - SIDE * 2 ? (w - cw) / 2 : clamp(ox, w - cw - SIDE, SIDE)
    const tp = topPad()
    oy = ch + tp + BOTTOM_PAD <= h ? tp : clamp(oy, h - ch - BOTTOM_PAD, tp)
    return { ox, oy, scale: v.scale }
  }
  const saveTimer = useRef<number | undefined>(undefined)
  const viewStoreKey = viewKey ? `notlarim.view.${viewKey}` : null
  const saveView = () => {
    if (!viewStoreKey) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const v = view.current
      const data = notebook() ? { z: zoomRel.current, t: (topPad() - v.oy) / v.scale, x: v.ox } : v
      try {
        localStorage.setItem(viewStoreKey, JSON.stringify(data))
      } catch {
        /* ignore */
      }
    }, 400)
  }
  const restoreView = (): boolean => {
    if (!viewStoreKey) return false
    try {
      const raw = localStorage.getItem(viewStoreKey)
      if (!raw) return false
      const d = JSON.parse(raw)
      if (notebook()) {
        zoomRel.current = clamp(Number(d.z) || 1, 0.35, 6)
        const scale = fitScale() * zoomRel.current
        view.current = clampView({ ox: Number(d.x) || SIDE, oy: topPad() - (Number(d.t) || 0) * scale, scale })
      } else {
        view.current = { ox: Number(d.ox) || 0, oy: Number(d.oy) || 0, scale: clamp(Number(d.scale) || 1, 0.12, 6) }
      }
      return true
    } catch {
      return false
    }
  }
  const setView = (v: View) => {
    view.current = clampView(v)
    if (notebook()) zoomRel.current = view.current.scale / fitScale()
    scheduleBase()
    scheduleLive()
    saveView()
  }

  // ---------- coordinates ----------
  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }
  const toWorld = (sx: number, sy: number) => {
    const v = view.current
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale }
  }
  const toLocal = (pageIndex: number, sx: number, sy: number) => {
    const { x, y } = toWorld(sx, sy)
    return { x, y: y - topOf(pageIndex) }
  }
  const pageAt = (wy: number): number => {
    if (!notebook()) return 0
    const { tops } = getLayout()
    for (let i = 0; i < tops.length; i++) {
      if (wy >= tops[i] && wy <= tops[i] + pageH(pagesRef.current[i])) return i
    }
    return -1
  }
  const nearestPage = (wy: number): number => {
    const { tops } = getLayout()
    let best = 0
    for (let i = 0; i < tops.length; i++) if (tops[i] <= wy) best = i
    return best
  }
  const pressureOf = (e: { pointerType: string; pressure: number }) =>
    e.pointerType === 'pen' ? r2(Math.max(0.05, e.pressure || 0.5)) : 0.5

  // Selection box in screen pixels (includes the in-progress drag).
  const selScreenBox = () => {
    const s = sel.current
    if (!s) return null
    const d = drag.current
    const { x0, y0, x1, y1 } = s.box
    const k = d ? d.s : 1
    const tx = d ? d.tx : 0
    const ty = d ? d.ty : 0
    const v = view.current
    const top = topOf(s.pageIndex)
    const bx0 = x0 + tx
    const by0 = y0 + ty
    const bx1 = x0 + (x1 - x0) * k + tx
    const by1 = y0 + (y1 - y0) * k + ty
    return {
      left: v.ox + bx0 * v.scale,
      top: v.oy + (top + by0) * v.scale,
      right: v.ox + bx1 * v.scale,
      bottom: v.oy + (top + by1) * v.scale,
    }
  }
  const hitSelection = (sx: number, sy: number): 'move' | 'scale' | null => {
    const b = selScreenBox()
    if (!b) return null
    if (Math.hypot(sx - b.right, sy - b.bottom) <= HANDLE_R) return 'scale'
    const pad = 12
    if (sx >= b.left - pad && sx <= b.right + pad && sy >= b.top - pad && sy <= b.bottom + pad) return 'move'
    return null
  }

  // ---------- rendering ----------
  const scheduleBase = () => {
    if (!frame.current.base) frame.current.base = requestAnimationFrame(drawBase)
  }
  const scheduleLive = () => {
    if (!frame.current.live) frame.current.live = requestAnimationFrame(drawLive)
  }

  const paintPageContent = (ctx: CanvasRenderingContext2D, pg: Page, x0: number, y0: number, x1: number, y1: number, skip: boolean, pageIndex: number) => {
    const s = sel.current
    const hide = skip && s && s.pageIndex === pageIndex
    for (const h of highlightsRef.current ?? []) {
      if (h.pageIndex !== pageIndex) continue
      ctx.fillStyle = h.active ? 'rgba(237, 147, 177, 0.55)' : 'rgba(255, 228, 92, 0.45)'
      for (const [rx, ry, rw, rh] of h.rects) ctx.fillRect(rx - 3, ry - 2, rw + 6, rh + 4)
    }
    paintImages(ctx, pg.images ?? [], hide ? s.imageIds : undefined)
    const rp = replayRef.current
    const fade = rp ? (st: Stroke) => !!st.t && st.t >= rp.from && st.t <= rp.to && st.t > rp.now : undefined
    paintStrokes(ctx, pg.strokes, x0, y0, x1, y1, hide ? s.strokeIds : undefined, fade)
  }

  const drawBase = () => {
    frame.current.base = 0
    const c = baseRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { w, h, dpr } = size.current
    const { ox, oy, scale } = view.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
    const x0 = -ox / scale
    const y0 = -oy / scale
    const x1 = (w - ox) / scale
    const y1 = (h - oy) / scale
    const list = pagesRef.current
    const dragging = !!drag.current

    if (notebook()) {
      const { tops } = getLayout()
      const tier = tierFor(PAGE_W * scale * dpr)
      list.forEach((pg, i) => {
        const top = tops[i]
        const ph = pageH(pg)
        if (top > y1 || top + ph < y0) return
        ctx.save()
        ctx.translate(0, top)
        ctx.fillStyle = 'rgba(114, 36, 62, 0.07)'
        ctx.fillRect(2 / scale, 4 / scale, PAGE_W, ph)
        ctx.fillStyle = PAPER_COLOR
        ctx.fillRect(0, 0, PAGE_W, ph)
        ctx.beginPath()
        ctx.rect(0, 0, PAGE_W, ph)
        ctx.clip()
        const ly0 = Math.max(0, y0 - top)
        const ly1 = Math.min(ph, y1 - top)
        if (pg.bg) {
          const bmp = pdfBitmap(pg.bg.fileId, pg.bg.page, tier)
          if (bmp) ctx.drawImage(bmp, 0, 0, PAGE_W, ph)
        } else {
          const style = pg.paper ?? paperRef.current
          paintPaper(ctx, style, 0, ly0, PAGE_W, ly1, scale, {
            topMargin: 110,
            leftMargin: style === 'lined' ? 88 : undefined,
          })
        }
        paintPageContent(ctx, pg, x0, ly0, x1, ly1, dragging, i)
        ctx.restore()
      })
      // Report which page is in the middle of the screen (for "add page after this one").
      const mid = nearestPage((h / 2 - oy) / scale)
      if (mid !== lastVisible.current) {
        lastVisible.current = mid
        onVisibleRef.current?.(mid)
      }
    } else {
      ctx.fillStyle = PAPER_COLOR
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      paintPaper(ctx, paperRef.current, x0, y0, x1, y1, scale)
      if (list[0]) paintPageContent(ctx, list[0], x0, y0, x1, y1, dragging, 0)
    }
  }

  const drawLive = () => {
    frame.current.live = 0
    const c = liveRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { dpr } = size.current
    const { ox, oy, scale } = view.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const world = () => ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
    const clipPage = (i: number) => {
      ctx.translate(0, topOf(i))
      if (notebook()) {
        ctx.beginPath()
        ctx.rect(0, 0, PAGE_W, heightOf(i))
        ctx.clip()
      }
    }

    const d = drawing.current
    if (d) {
      world()
      ctx.save()
      clipPage(d.pageIndex)
      if (d.shape) {
        for (const st of shapeStrokes(d.shape.kind, d.shape.a, d.shape.b, d.stroke, () => '')) paintLiveStroke(ctx, st)
      } else paintLiveStroke(ctx, d.stroke)
      ctx.restore()
    }

    const l = lasso.current
    if (l && l.pts.length > 1) {
      world()
      ctx.save()
      ctx.translate(0, topOf(l.pageIndex))
      ctx.beginPath()
      ctx.moveTo(l.pts[0][0], l.pts[0][1])
      for (const [x, y] of l.pts) ctx.lineTo(x, y)
      ctx.fillStyle = 'rgba(237, 147, 177, 0.1)'
      ctx.fill()
      ctx.setLineDash([6 / scale, 5 / scale])
      ctx.lineWidth = 1.6 / scale
      ctx.strokeStyle = '#D4537E'
      ctx.stroke()
      ctx.restore()
    }

    const s = sel.current
    const g = drag.current
    if (s && g) {
      // Selected items follow the finger here; the base canvas leaves them out meanwhile.
      const pg = pagesRef.current[s.pageIndex]
      if (pg) {
        world()
        ctx.save()
        clipPage(s.pageIndex)
        ctx.translate(s.box.x0 + g.tx, s.box.y0 + g.ty)
        ctx.scale(g.s, g.s)
        ctx.translate(-s.box.x0, -s.box.y0)
        paintImages(ctx, (pg.images ?? []).filter((im) => s.imageIds.has(im.id)))
        paintStrokes(ctx, pg.strokes.filter((st) => s.strokeIds.has(st.id)), -Infinity, -Infinity, Infinity, Infinity)
        ctx.restore()
      }
    }
    const b = selScreenBox()
    if (b) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#D4537E'
      ctx.strokeRect(b.left - 6, b.top - 6, b.right - b.left + 12, b.bottom - b.top + 12)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(b.right, b.bottom, 9, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    const er = erasing.current
    if (er?.cursor) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.beginPath()
      ctx.arc(er.cursor.sx, er.cursor.sy, getSettings().eraserSize * scale, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(237, 147, 177, 0.18)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#D4537E'
      ctx.stroke()
    }
    syncSelUi(b)
  }

  const lastUi = useRef('')
  const syncSelUi = (b: ReturnType<typeof selScreenBox>) => {
    const next = b && !drag.current && !gesture.current ? { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top } : null
    const key = next ? `${Math.round(next.left)},${Math.round(next.top)},${Math.round(next.width)}` : ''
    if (key !== lastUi.current) {
      lastUi.current = key
      setSelUi(next)
    }
  }

  // ---------- selection ----------
  const setSelection = (pageIndex: number, strokeIds: Set<string>, imageIds: Set<string>) => {
    const pg = pagesRef.current[pageIndex]
    const box = pg && boxOf(pg, strokeIds, imageIds)
    sel.current = box ? { pageIndex, strokeIds, imageIds, box } : null
    scheduleLive()
  }
  const clearSelection = () => {
    if (!sel.current) return
    sel.current = null
    drag.current = null
    scheduleLive()
    scheduleBase()
  }

  const finishLasso = () => {
    const l = lasso.current
    lasso.current = null
    if (!l || l.pts.length < 3) {
      scheduleLive()
      return
    }
    const pg = pagesRef.current[l.pageIndex]
    const strokeIds = new Set<string>()
    const imageIds = new Set<string>()
    for (const s of pg.strokes) {
      let inside = 0
      for (const [x, y] of s.points) if (pointInPolygon(x, y, l.pts)) inside++
      if (inside > 0 && inside >= s.points.length * 0.5) strokeIds.add(s.id)
    }
    for (const im of pg.images ?? []) {
      if (pointInPolygon(im.x + im.w / 2, im.y + im.h / 2, l.pts)) imageIds.add(im.id)
    }
    if (strokeIds.size || imageIds.size) setSelection(l.pageIndex, strokeIds, imageIds)
    scheduleLive()
  }

  const commitDrag = () => {
    const d = drag.current
    const s = sel.current
    drag.current = null
    if (!d || !s) return
    if (d.tx === 0 && d.ty === 0 && d.s === 1) {
      scheduleBase()
      scheduleLive()
      return
    }
    const { x0, y0 } = s.box
    const T = (x: number, y: number): [number, number] => [r2(x0 + (x - x0) * d.s + d.tx), r2(y0 + (y - y0) * d.s + d.ty)]
    const list = pagesRef.current
    const pg = list[s.pageIndex]
    const strokes = pg.strokes.map((st) =>
      s.strokeIds.has(st.id)
        ? { ...st, size: r2(st.size * d.s), points: st.points.map(([x, y, p]) => [...T(x, y), p] as Point) }
        : st,
    )
    const images = (pg.images ?? []).map((im) => {
      if (!s.imageIds.has(im.id)) return im
      const [x, y] = T(im.x, im.y)
      return { ...im, x, y, w: r2(im.w * d.s), h: r2(im.h * d.s) }
    })
    const next = list.map((p, i) => (i === s.pageIndex ? { ...p, strokes, images } : p))
    pagesRef.current = next
    onChangeRef.current(next, true)
    setSelection(s.pageIndex, s.strokeIds, s.imageIds)
    scheduleBase()
  }

  const deleteSelection = () => {
    const s = sel.current
    if (!s) return
    const next = pagesRef.current.map((p, i) =>
      i === s.pageIndex
        ? { ...p, strokes: p.strokes.filter((st) => !s.strokeIds.has(st.id)), images: (p.images ?? []).filter((im) => !s.imageIds.has(im.id)) }
        : p,
    )
    sel.current = null
    pagesRef.current = next
    onChangeRef.current(next, true)
    scheduleBase()
    scheduleLive()
  }

  const duplicateSelection = () => {
    const s = sel.current
    if (!s) return
    const off = 28
    const pg = pagesRef.current[s.pageIndex]
    const newStrokes: Stroke[] = pg.strokes
      .filter((st) => s.strokeIds.has(st.id))
      .map((st) => ({ ...st, id: uid(), points: st.points.map(([x, y, p]) => [r2(x + off), r2(y + off), p] as Point) }))
    const newImages: ImageItem[] = (pg.images ?? []).filter((im) => s.imageIds.has(im.id)).map((im) => ({ ...im, id: uid(), x: im.x + off, y: im.y + off }))
    const next = pagesRef.current.map((p, i) =>
      i === s.pageIndex ? { ...p, strokes: [...p.strokes, ...newStrokes], images: [...(p.images ?? []), ...newImages] } : p,
    )
    pagesRef.current = next
    onChangeRef.current(next, true)
    setSelection(s.pageIndex, new Set(newStrokes.map((x) => x.id)), new Set(newImages.map((x) => x.id)))
    scheduleBase()
  }

  // ---------- ink ----------
  const startInk = (e: RPointerEvent, sx: number, sy: number) => {
    const st = getSettings()
    const base: Active = { pointerId: e.pointerId, pointerType: e.pointerType }
    if (seekRef.current) {
      seekTap.current = { ...base, sx, sy, at: performance.now() }
      return
    }
    if (st.tool === 'lasso') {
      const hit = sel.current ? hitSelection(sx, sy) : null
      if (hit && sel.current) {
        const { x, y } = toLocal(sel.current.pageIndex, sx, sy)
        drag.current = { ...base, mode: hit, sx: x, sy: y, tx: 0, ty: 0, s: 1 }
        scheduleBase()
        scheduleLive()
        return
      }
      clearSelection()
      const { y } = toWorld(sx, sy)
      const idx = pageAt(y)
      if (idx < 0) return
      const p = toLocal(idx, sx, sy)
      lasso.current = { ...base, pageIndex: idx, pts: [[p.x, p.y]] }
      return
    }
    clearSelection()
    if (st.tool === 'eraser') {
      erasing.current = { ...base, changed: false, last: null, cursor: null }
      eraseAt(sx, sy)
      return
    }
    const { y } = toWorld(sx, sy)
    const idx = pageAt(y)
    if (idx < 0) return
    const hl = st.tool === 'highlighter'
    const lp = toLocal(idx, sx, sy)
    drawing.current = {
      ...base,
      pageIndex: idx,
      stroke: {
        id: uid(),
        tool: hl ? 'highlighter' : 'pen',
        color: hl ? st.hlColor : st.penColor,
        size: hl ? st.hlSize : st.penSize,
        sp: e.pointerType !== 'pen',
        t: Date.now(),
        points: [[r2(lp.x), r2(lp.y), pressureOf(e)]],
      },
      ...(st.tool === 'shape' ? { shape: { kind: st.shapeKind, a: [lp.x, lp.y] as [number, number], b: [lp.x, lp.y] as [number, number] } } : {}),
    }
    scheduleLive()
  }

  const moveInk = (e: RPointerEvent) => {
    const native = e.nativeEvent
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const events = coalesced.length ? coalesced : [native]

    const d = drawing.current
    if (d?.shape) {
      const { sx, sy } = screenPoint(e)
      const lp = toLocal(d.pageIndex, sx, sy)
      const b: [number, number] = [lp.x, lp.y]
      d.shape.b = d.shape.kind === 'line' || d.shape.kind === 'arrow' ? snapEnd(d.shape.a, b) : b
      scheduleLive()
      return
    }
    if (seekTap.current) return
    if (d) {
      const pts = d.stroke.points
      for (const ev of events) {
        const { sx, sy } = screenPoint(ev)
        const lp = toLocal(d.pageIndex, sx, sy)
        const p: Point = [r2(lp.x), r2(lp.y), pressureOf(ev)]
        const last = pts[pts.length - 1]
        if (last && last[0] === p[0] && last[1] === p[1]) continue
        pts.push(p)
      }
      scheduleLive()
      return
    }
    const { sx, sy } = screenPoint(e)
    if (erasing.current) return eraseAt(sx, sy)
    const l = lasso.current
    if (l) {
      const p = toLocal(l.pageIndex, sx, sy)
      l.pts.push([r2(p.x), r2(p.y)])
      scheduleLive()
      return
    }
    const g = drag.current
    const s = sel.current
    if (g && s) {
      const p = toLocal(s.pageIndex, sx, sy)
      if (g.mode === 'move') {
        g.tx = p.x - g.sx
        g.ty = p.y - g.sy
      } else {
        const { x0, y0, x1, y1 } = s.box
        const diag = Math.max(1, x1 - x0 + (y1 - y0))
        g.s = clamp((p.x - x0 + (p.y - y0)) / diag, 0.1, 10)
      }
      scheduleLive()
    }
  }

  const endInk = () => {
    const d = drawing.current
    if (d?.shape) {
      drawing.current = null
      const { a, b } = d.shape
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4) {
        const added = shapeStrokes(d.shape.kind, a, b, d.stroke, uid)
        const next = pagesRef.current.map((p, i) => (i === d.pageIndex ? { ...p, strokes: [...p.strokes, ...added] } : p))
        pagesRef.current = next
        onChangeRef.current(next, true)
        scheduleBase()
      }
    } else if (seekTap.current) {
      seekTap.current = null
    } else if (d) {
      drawing.current = null
      if (d.stroke.points.length) {
        const next = pagesRef.current.map((p, i) => (i === d.pageIndex ? { ...p, strokes: [...p.strokes, d.stroke] } : p))
        pagesRef.current = next
        onChangeRef.current(next, true)
        scheduleBase()
      }
    } else if (erasing.current) erasing.current = null
    else if (lasso.current) finishLasso()
    else if (drag.current) commitDrag()
    scheduleLive()
  }

  /** Finds the stroke under a tap and jumps the recording to when it was written. */
  const resolveSeek = (sx: number, sy: number) => {
    const cb = seekRef.current
    if (!cb) return
    const { y } = toWorld(sx, sy)
    const idx = pageAt(y)
    if (idx < 0) return
    const p = toLocal(idx, sx, sy)
    const r = 14 / view.current.scale
    const strokes = pagesRef.current[idx].strokes
    for (let i = strokes.length - 1; i >= 0; i--) {
      const st = strokes[i]
      if (st.t && strokeHit(st, p.x, p.y, r)) return cb(st.t)
    }
  }

  const cancelInk = () => {
    drawing.current = null
    erasing.current = null
    lasso.current = null
    if (drag.current) {
      drag.current = null
      scheduleBase()
    }
    scheduleLive()
  }

  const eraseAt = (sx: number, sy: number) => {
    const er = erasing.current
    if (!er) return
    er.cursor = { sx, sy }
    const st = getSettings()
    const r = st.eraserSize
    const { x, y } = toWorld(sx, sy)
    const samples: { x: number; y: number }[] = []
    if (er.last) {
      const dx = x - er.last.x
      const dy = y - er.last.y
      const n = Math.min(40, Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.5))))
      for (let k = 1; k <= n; k++) samples.push({ x: er.last.x + (dx * k) / n, y: er.last.y + (dy * k) / n })
    } else {
      samples.push({ x, y })
    }
    er.last = { x, y }
    const erase = st.eraserMode === 'pixel' ? erasePixels : eraseStrokes
    let list = pagesRef.current
    let changed = false
    for (const s of samples) {
      const idx = pageAt(s.y)
      if (idx < 0) continue
      const cur = list[idx].strokes
      const next = erase(cur, s.x, s.y - topOf(idx), r)
      if (next !== cur) {
        if (!changed) list = [...list]
        list[idx] = { ...list[idx], strokes: next }
        changed = true
      }
    }
    if (changed) {
      pagesRef.current = list
      onChangeRef.current(list, !er.changed)
      er.changed = true
      scheduleBase()
    }
    scheduleLive()
  }

  // ---------- gestures ----------
  const beginGesture = () => {
    const pts = [...touches.current.values()]
    const v = { ...view.current }
    if (pts.length === 1) gesture.current = { kind: 'pan', sx: pts[0].x, sy: pts[0].y, v }
    else if (pts.length >= 2) {
      const [a, b] = pts
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v }
    } else gesture.current = null
  }

  const moveGesture = () => {
    const g = gesture.current
    const pts = [...touches.current.values()]
    if (!g) return
    if (g.kind === 'pan' && pts.length === 1) {
      setView({ ox: g.v.ox + pts[0].x - g.sx, oy: g.v.oy + pts[0].y - g.sy, scale: g.v.scale })
    } else if (g.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const [lo, hi] = scaleLimits()
      const scale = clamp((g.v.scale * dist) / g.dist, lo, hi)
      const wx = (g.mx - g.v.ox) / g.v.scale
      const wy = (g.my - g.v.oy) / g.v.scale
      setView({ ox: mx - wx * scale, oy: my - wy * scale, scale })
    }
  }

  // ---------- pointer handlers ----------
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const { sx, sy } = screenPoint(e)
    const wrap = wrapRef.current!
    const ink = active()
    const isNav = e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button !== 0)
    const capture = () => {
      try {
        wrap.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    if (isNav) {
      // Palm rejection: while the pencil is on the glass, touches are ignored.
      if (ink && ink.pointerType !== 'touch') return
      capture()
      // A finger can move an existing selection even when finger drawing is off.
      if (e.pointerType === 'touch' && !ink && touches.current.size === 0 && getSettings().tool === 'lasso' && sel.current) {
        const hit = hitSelection(sx, sy)
        if (hit) {
          const { x, y } = toLocal(sel.current.pageIndex, sx, sy)
          drag.current = { pointerId: e.pointerId, pointerType: 'touch', mode: hit, sx: x, sy: y, tx: 0, ty: 0, s: 1 }
          scheduleBase()
          scheduleLive()
          return
        }
      }
      touches.current.set(e.pointerId, { x: sx, y: sy })
      if (touches.current.size === 1) tap.current = { start: performance.now(), max: 1, moved: 0 }
      else tap.current.max = Math.max(tap.current.max, touches.current.size)

      if (e.pointerType === 'touch' && touches.current.size === 1 && getSettings().fingerDraw) {
        startInk(e, sx, sy)
        return
      }
      if (ink && ink.pointerType === 'touch') cancelInk()
      beginGesture()
      scheduleLive()
      return
    }

    if (ink) return
    if (e.pointerType === 'pen') {
      touches.current.clear()
      gesture.current = null
    }
    capture()
    startInk(e, sx, sy)
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const ink = active()
    if (ink && ink.pointerId === e.pointerId) {
      moveInk(e)
      return
    }
    const prev = touches.current.get(e.pointerId)
    if (prev) {
      const { sx, sy } = screenPoint(e)
      tap.current.moved += Math.hypot(sx - prev.x, sy - prev.y)
      touches.current.set(e.pointerId, { x: sx, y: sy })
      moveGesture()
    }
  }

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const ink = active()
    const st = seekTap.current
    if (st && st.pointerId === e.pointerId) {
      const { sx, sy } = screenPoint(e)
      if (Math.hypot(sx - st.sx, sy - st.sy) < 10 && performance.now() - st.at < 500) resolveSeek(sx, sy)
    }
    if (ink && ink.pointerId === e.pointerId) endInk()
    if (touches.current.has(e.pointerId)) {
      touches.current.delete(e.pointerId)
      if (touches.current.size === 0) {
        gesture.current = null
        scheduleLive()
        const t = tap.current
        if (t.max === 2 && performance.now() - t.start < 300 && t.moved < 30) onUndoRef.current()
        else if (t.max === 1 && seekRef.current && performance.now() - t.start < 400 && t.moved < 10) {
          const { sx, sy } = screenPoint(e)
          resolveSeek(sx, sy)
        }
      } else beginGesture()
    }
  }

  // ---------- effects ----------
  useEffect(() => {
    const wrap = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      if (!r.width || !r.height) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const prevW = size.current.w
      size.current = { w: r.width, h: r.height, dpr }
      for (const c of [baseRef.current, liveRef.current]) {
        if (!c) continue
        c.width = Math.round(r.width * dpr)
        c.height = Math.round(r.height * dpr)
      }
      if (notebook()) {
        if (!fitted.current) {
          fitted.current = true
          if (!restoreView()) {
            zoomRel.current = 1
            view.current = clampView({ ox: SIDE, oy: topPad(), scale: fitScale() })
          }
        } else if (prevW !== r.width) {
          const v = view.current
          const scale = fitScale() * zoomRel.current
          view.current = clampView({ ox: v.ox, oy: (v.oy * scale) / v.scale, scale })
        } else view.current = clampView(view.current)
      } else if (!fitted.current) {
        fitted.current = true
        if (!restoreView()) view.current = { ox: 0, oy: 0, scale: r.width < 700 ? 0.6 : 1 }
      }
      scheduleBase()
      scheduleLive()
    })
    ro.observe(wrap)

    const prevent = (ev: Event) => {
      // Buttons inside the board (selection bar) still need their taps.
      if ((ev.target as Element | null)?.closest?.('.sel-bar')) return
      ev.preventDefault()
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const v = view.current
      if (ev.ctrlKey || ev.metaKey) {
        const { sx, sy } = screenPoint(ev)
        const [lo, hi] = scaleLimits()
        const scale = clamp(v.scale * Math.exp(-ev.deltaY * 0.01), lo, hi)
        const wx = (sx - v.ox) / v.scale
        const wy = (sy - v.oy) / v.scale
        setView({ ox: sx - wx * scale, oy: sy - wy * scale, scale })
      } else {
        setView({ ox: v.ox - ev.deltaX, oy: v.oy - ev.deltaY, scale: v.scale })
      }
    }
    const onKey = (ev: KeyboardEvent) => {
      if (!sel.current) return
      const t = ev.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        ev.preventDefault()
        deleteSelection()
      } else if (ev.key === 'Escape') clearSelection()
    }
    wrap.addEventListener('touchstart', prevent, { passive: false })
    wrap.addEventListener('touchmove', prevent, { passive: false })
    wrap.addEventListener('gesturestart', prevent)
    wrap.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    const offAssets = onAssetReady(scheduleBase)
    const frames = frame.current
    return () => {
      ro.disconnect()
      wrap.removeEventListener('touchstart', prevent)
      wrap.removeEventListener('touchmove', prevent)
      wrap.removeEventListener('gesturestart', prevent)
      wrap.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      offAssets()
      window.clearTimeout(saveTimer.current)
      cancelAnimationFrame(frames.base)
      cancelAnimationFrame(frames.live)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (notebook()) view.current = clampView(view.current)
    // After undo/redo the selected items may have moved or disappeared.
    const s = sel.current
    if (s && !drag.current) {
      const pg = pages[s.pageIndex]
      const box = pg && boxOf(pg, s.strokeIds, s.imageIds)
      if (box) s.box = box
      else sel.current = null
    }
    scheduleBase()
    scheduleLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, paper, mode])

  useEffect(() => {
    scheduleBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay?.now, replay?.from, highlights])

  useEffect(() => {
    if (fitted.current) setView(view.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolbarEdge, toolbarCollapsed])

  useEffect(() => {
    if (tool !== 'lasso') clearSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  useEffect(() => {
    if (!scrollToPage || !notebook()) return
    const v = view.current
    setView({ ox: v.ox, oy: topPad() - topOf(scrollToPage.index) * v.scale, scale: v.scale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToPage])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      dropTarget() {
        const { w, h } = size.current
        const { x, y } = toWorld(w / 2, h / 2)
        const idx = notebook() ? nearestPage(y) : 0
        const ph = notebook() ? pageH(pagesRef.current[idx]) : PAGE_H
        const ly = y - topOf(idx)
        return { pageIndex: idx, x: notebook() ? PAGE_W / 2 : x, y: notebook() ? clamp(ly, 0, ph) : ly, pageH: ph }
      },
      select(pageIndex, strokeIds, imageIds) {
        setSelection(pageIndex, new Set(strokeIds), new Set(imageIds))
      },
    }
    return () => {
      apiRef.current = null
    }
  })

  const barAbove = selUi && selUi.top > 70
  return (
    <div
      ref={wrapRef}
      className={`board tool-${tool} ${onSeekTap ? 'seek-mode' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={baseRef} className="board-canvas" aria-label="Çizim alanı" />
      <canvas ref={liveRef} className="board-canvas board-live" aria-hidden="true" />
      {selUi && (
        <div
          className="sel-bar"
          style={{
            left: selUi.left + selUi.width / 2,
            top: barAbove ? selUi.top - 14 : selUi.top + selUi.height + 14,
            translate: barAbove ? '-50% -100%' : '-50% 0',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button onClick={duplicateSelection}>
            <Copy size={16} /> Çoğalt
          </button>
          <button className="danger" onClick={deleteSelection}>
            <Trash2 size={16} /> Sil
          </button>
        </div>
      )}
    </div>
  )
}

