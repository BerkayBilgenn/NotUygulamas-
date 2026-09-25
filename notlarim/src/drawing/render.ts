import { getStroke } from 'perfect-freehand'
import type { ImageItem, Page, PaperStyle, Point, Stroke } from '../types'
import { imageBitmap } from './assetCache'

export const PAGE_W = 1000
export const PAGE_H = 1414
export const PAGE_GAP = 36
export const LINE_SPACING = 44

export const pageH = (p: Page | undefined) => p?.h ?? PAGE_H

/** Top edge of every page in notebook mode (pages can have different heights, e.g. PDF slides). */
export function layoutPages(pages: Page[]): { tops: number[]; total: number } {
  const tops: number[] = []
  let y = 0
  for (const p of pages) {
    tops.push(y)
    y += pageH(p) + PAGE_GAP
  }
  return { tops, total: Math.max(0, y - PAGE_GAP) }
}

export function strokeBounds(s: Stroke) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of s.points) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  const pad = s.size
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
}

/** Placed images; a soft placeholder is painted until the bitmap is decoded. */
export function paintImages(ctx: CanvasRenderingContext2D, items: ImageItem[], skip?: Set<string>) {
  for (const im of items) {
    if (skip?.has(im.id)) continue
    const bmp = imageBitmap(im.fileId)
    if (bmp) ctx.drawImage(bmp, im.x, im.y, im.w, im.h)
    else {
      ctx.fillStyle = 'rgba(237, 147, 177, 0.18)'
      ctx.fillRect(im.x, im.y, im.w, im.h)
    }
  }
}

interface Cached {
  path: Path2D
  minX: number
  minY: number
  maxX: number
  maxY: number
}
const cache = new WeakMap<Stroke, Cached>()

function strokeOutline(points: Point[], tool: Stroke['tool'], size: number, sp: boolean, last: boolean, shape = false) {
  if (shape) {
    return getStroke(points, { size, thinning: 0, smoothing: 0.25, streamline: 0, simulatePressure: false, last })
  }
  if (tool === 'highlighter') {
    return getStroke(points, { size, thinning: 0, smoothing: 0.6, streamline: 0.55, simulatePressure: false, last })
  }
  return getStroke(points, { size, thinning: 0.62, smoothing: 0.55, streamline: 0.42, simulatePressure: sp, last })
}

function outlineToPath(pts: number[][]): Path2D {
  const p = new Path2D()
  if (!pts.length) return p
  p.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  p.closePath()
  return p
}

function getCached(s: Stroke): Cached {
  let c = cache.get(s)
  if (!c) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of s.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const pad = s.size
    c = {
      path: outlineToPath(strokeOutline(s.points, s.tool, s.size, s.sp, true, s.shape)),
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    }
    cache.set(s, c)
  }
  return c
}

export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const c = getCached(s)
  fillStroke(ctx, s, c.path)
}

/** Paints strokes intersecting the visible rect (in the same coordinates as the strokes). */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  vx0: number,
  vy0: number,
  vx1: number,
  vy1: number,
  skip?: Set<string>,
  /** Strokes to dim, e.g. ones written after the current point of an audio replay. */
  fade?: (s: Stroke) => boolean,
) {
  for (const s of strokes) {
    if (skip?.has(s.id)) continue
    const c = getCached(s)
    if (c.maxX < vx0 || c.minX > vx1 || c.maxY < vy0 || c.minY > vy1) continue
    if (fade?.(s)) {
      ctx.save()
      ctx.globalAlpha = 0.2
      fillStroke(ctx, s, c.path)
      ctx.restore()
    } else fillStroke(ctx, s, c.path)
  }
}

/** Same outline as on screen, as an SVG path (used for vector PDF export). */
export function strokeSvgPath(s: Stroke): string {
  const pts = strokeOutline(s.points, s.tool, s.size, s.sp, true, s.shape)
  if (!pts.length) return ''
  const f = (n: number) => (Math.round(n * 100) / 100).toString()
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    d += `Q${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`
  }
  return d + 'Z'
}

export function paintLiveStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  fillStroke(ctx, s, outlineToPath(strokeOutline(s.points, s.tool, s.size, s.sp, !!s.shape, s.shape)))
}

function fillStroke(ctx: CanvasRenderingContext2D, s: Stroke, path: Path2D) {
  ctx.fillStyle = s.color
  if (s.tool === 'highlighter') {
    ctx.save()
    ctx.globalAlpha = 0.42
    ctx.globalCompositeOperation = 'multiply'
    ctx.fill(path)
    ctx.restore()
  } else {
    ctx.fill(path)
  }
}

export const PAPER_COLOR = '#FFFDFE'
const LINE_COLOR = '#F3C9D7'
const GRID_COLOR = '#F6DCE5'
const MARGIN_COLOR = '#ED93B1'

/** Paints a paper pattern over the rect [x0,x1]×[y0,y1]; pattern is anchored to world origin. */
export function paintPaper(
  ctx: CanvasRenderingContext2D,
  style: PaperStyle,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  scale: number,
  opts: { topMargin?: number; leftMargin?: number } = {},
) {
  const px = 1 / scale
  const s = LINE_SPACING
  if (style === 'lined') {
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = Math.max(1.1, px)
    ctx.beginPath()
    const start = Math.max(y0, opts.topMargin ?? -Infinity)
    for (let y = Math.ceil(start / s) * s; y <= y1; y += s) {
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()
    if (opts.leftMargin !== undefined) {
      ctx.strokeStyle = MARGIN_COLOR
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(opts.leftMargin, y0)
      ctx.lineTo(opts.leftMargin, y1)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  } else if (style === 'grid') {
    // Skip drawing individual lines when zoomed far out, they'd become a solid wash.
    if (s * scale < 5) return
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = Math.max(1, px)
    ctx.beginPath()
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
    }
    for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
    }
    ctx.stroke()
  } else if (style === 'dots') {
    if (s * scale < 6) return
    ctx.fillStyle = LINE_COLOR
    const r = Math.max(1.8, 1.4 * px)
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        ctx.fillRect(x - r / 2, y - r / 2, r, r)
      }
    }
  }
}
