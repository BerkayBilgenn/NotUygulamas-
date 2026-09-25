import { describe, expect, it } from 'vitest'
import type { Point, Stroke } from '../types'
import { erasePixels, eraseStrokes, strokeHit } from './eraser'

function line(x0: number, x1: number, y = 0, step = 10, id = 's'): Stroke {
  const points: Point[] = []
  for (let x = x0; x <= x1; x += step) points.push([x, y, 0.5])
  return { id, tool: 'pen', color: '#000', size: 2, sp: false, points }
}

describe('piksel silgisi', () => {
  it('ortasından silinen çizgiyi ikiye böler', () => {
    const out = erasePixels([line(0, 100)], 50, 0, 8)
    expect(out).toHaveLength(2)
    const [a, b] = out
    expect(a.points.every(([x]) => x < 50)).toBe(true)
    expect(b.points.every(([x]) => x > 50)).toBe(true)
    expect(a.id).not.toBe(b.id)
  })

  it('ucundan silinen çizgiyi kısaltır', () => {
    const out = erasePixels([line(0, 100)], 100, 0, 8)
    expect(out).toHaveLength(1)
    expect(Math.max(...out[0].points.map(([x]) => x))).toBeLessThan(100)
  })

  it('noktalar seyrek olsa bile aradan geçen silgiyi yakalar', () => {
    const sparse = line(0, 100, 0, 50) // points at 0, 50, 100
    const out = erasePixels([sparse], 25, 0, 4)
    expect(out.length).toBe(2)
  })

  it('dokunmayan silgi aynı diziyi döndürür (geçmişe gereksiz kayıt düşmez)', () => {
    const strokes = [line(0, 100)]
    expect(erasePixels(strokes, 50, 200, 8)).toBe(strokes)
  })

  it('tek nokta kalan parçaları atar', () => {
    const out = erasePixels([line(0, 30)], 20, 0, 12)
    expect(out.every((s) => s.points.length >= 2)).toBe(true)
  })
})

describe('çizgi silgisi', () => {
  it('dokunulan çizgiyi tamamen siler, diğerlerini korur', () => {
    const a = line(0, 100, 0, 10, 'a')
    const b = line(0, 100, 200, 10, 'b')
    const out = eraseStrokes([a, b], 50, 0, 5)
    expect(out.map((s) => s.id)).toEqual(['b'])
  })

  it('çizgi kalınlığını hesaba katar', () => {
    const thick = { ...line(0, 100), size: 20 }
    expect(strokeHit(thick, 50, 12, 3)).toBe(true)
    expect(strokeHit({ ...thick, size: 2 }, 50, 12, 3)).toBe(false)
  })
})
