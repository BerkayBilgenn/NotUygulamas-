import type { Point, Stroke } from '../types'
import { uid } from './id'

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function bbox(points: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function nearBox(points: Point[], x: number, y: number, r: number) {
  const b = bbox(points)
  return x >= b.minX - r && x <= b.maxX + r && y >= b.minY - r && y <= b.maxY + r
}

/** True if the circle (x, y, r) touches the stroke. */
export function strokeHit(stroke: Stroke, x: number, y: number, r: number): boolean {
  const rr = r + stroke.size / 2
  const pts = stroke.points
  if (!pts.length || !nearBox(pts, x, y, rr)) return false
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= rr
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rr) return true
  }
  return false
}

/** Whole-stroke eraser. Returns the same array when nothing was hit. */
export function eraseStrokes(strokes: Stroke[], x: number, y: number, r: number): Stroke[] {
  const kept = strokes.filter((s) => !strokeHit(s, x, y, r))
  return kept.length === strokes.length ? strokes : kept
}

/** Parameters (0..1) where segment a→b enters and leaves the circle, or null. */
function segmentCircle(a: Point, b: Point, cx: number, cy: number, r: number): [number, number] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const fx = a[0] - cx
  const fy = a[1] - cy
  const A = dx * dx + dy * dy
  if (A === 0) return null
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-B - sq) / (2 * A)
  const t2 = (-B + sq) / (2 * A)
  if (t2 < 0 || t1 > 1) return null
  return [Math.max(0, t1), Math.min(1, t2)]
}

const round2 = (n: number) => Math.round(n * 100) / 100
function lerp(a: Point, b: Point, t: number): Point {
  return [round2(a[0] + (b[0] - a[0]) * t), round2(a[1] + (b[1] - a[1]) * t), round2(a[2] + (b[2] - a[2]) * t)]
}

/**
 * Pixel eraser: removes the parts of strokes inside the circle and splits
 * strokes that are cut through. Cut points are placed exactly on the circle
 * edge, so sparse (fast) strokes keep all their visible ink outside it.
 * Returns the same array when nothing changed.
 */
export function erasePixels(strokes: Stroke[], x: number, y: number, r: number): Stroke[] {
  let changed = false
  const out: Stroke[] = []
  for (const s of strokes) {
    const rr = r + s.size / 2
    if (!strokeHit(s, x, y, r)) {
      out.push(s)
      continue
    }
    changed = true
    const runs: Point[][] = []
    let run: Point[] = []
    let prev: Point | null = null
    let prevInside = false
    for (const p of s.points) {
      const inside = Math.hypot(p[0] - x, p[1] - y) <= rr
      if (prev) {
        const hit = segmentCircle(prev, p, x, y, rr)
        if (!prevInside && !inside) {
          if (hit && hit[0] > 0 && hit[1] < 1) {
            run.push(lerp(prev, p, hit[0]))
            runs.push(run)
            run = [lerp(prev, p, hit[1])]
          }
        } else if (!prevInside && inside) {
          if (hit) run.push(lerp(prev, p, hit[0]))
          runs.push(run)
          run = []
        } else if (prevInside && !inside) {
          run = hit ? [lerp(prev, p, hit[1])] : []
        }
      }
      if (!inside) run.push(p)
      prev = p
      prevInside = inside
    }
    if (run.length) runs.push(run)
    for (const part of runs) {
      if (part.length < 2) continue
      out.push({ ...s, id: uid(), points: part })
    }
  }
  return changed ? out : strokes
}
