import type { Point, Stroke } from '../types'

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse'
type XY = [number, number]

const r2 = (n: number) => Math.round(n * 100) / 100

/** Points every `step` units along a polyline, so the outline stays smooth and even. */
function densify(pts: XY[], step = 5): Point[] {
  const out: Point[] = []
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    if (i === 0) {
      out.push([r2(x), r2(y), 0.5])
      continue
    }
    const [px, py] = pts[i - 1]
    const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / step))
    for (let k = 1; k <= n; k++) out.push([r2(px + ((x - px) * k) / n), r2(py + ((y - py) * k) / n), 0.5])
  }
  return out
}

/** Lines and arrows snap to horizontal, vertical and 45° when they're within a few degrees. */
export function snapEnd(a: XY, b: XY): XY {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1) return b
  const ang = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(ang / step) * step
  if (Math.abs(ang - snapped) > (5 * Math.PI) / 180) return b
  return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len]
}

export function shapePolylines(kind: ShapeKind, a: XY, b: XY, size: number): XY[][] {
  const [x0, y0] = a
  const [x1, y1] = b
  switch (kind) {
    case 'line':
      return [[a, b]]
    case 'arrow': {
      const len = Math.hypot(x1 - x0, y1 - y0)
      const head = Math.min(Math.max(len * 0.28, 14 + size * 2), 60)
      const ang = Math.atan2(y1 - y0, x1 - x0)
      const spread = (28 * Math.PI) / 180
      const h1: XY = [x1 - head * Math.cos(ang - spread), y1 - head * Math.sin(ang - spread)]
      const h2: XY = [x1 - head * Math.cos(ang + spread), y1 - head * Math.sin(ang + spread)]
      return [[a, b], [h1, b, h2]]
    }
    case 'rect':
      return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
    case 'ellipse': {
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const rx = Math.abs(x1 - x0) / 2
      const ry = Math.abs(y1 - y0) / 2
      const n = 72
      const pts: XY[] = []
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2
        pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
      }
      return [pts]
    }
  }
}

export function shapeStrokes(kind: ShapeKind, a: XY, b: XY, base: Pick<Stroke, 'color' | 'size'> & { t?: number }, makeId: () => string): Stroke[] {
  return shapePolylines(kind, a, b, base.size).map((line) => ({
    id: makeId(),
    tool: 'pen' as const,
    color: base.color,
    size: base.size,
    sp: false,
    shape: true,
    ...(base.t ? { t: base.t } : {}),
    points: densify(line),
  }))
}
