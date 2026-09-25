import { describe, expect, it } from 'vitest'
import { shapeStrokes, snapEnd } from './shapes'

let n = 0
const id = () => `s${n++}`

describe('şekil araçları', () => {
  it('ok gövde ve uç olarak iki çizgi üretir, ikisi de eşit kalınlıkta', () => {
    const out = shapeStrokes('arrow', [0, 0], [200, 0], { color: '#72243E', size: 4 }, id)
    expect(out).toHaveLength(2)
    expect(out.every((s) => s.shape && s.size === 4 && s.points.every((p) => p[2] === 0.5))).toBe(true)
    const tip = out[1].points.find((p) => p[0] === 200 && p[1] === 0)
    expect(tip).toBeTruthy()
  })

  it('dikdörtgen kapalı bir çizgi olur', () => {
    const [r] = shapeStrokes('rect', [10, 10], [110, 60], { color: '#000', size: 3 }, id)
    expect(r.points[0].slice(0, 2)).toEqual(r.points[r.points.length - 1].slice(0, 2))
  })

  it('elips kutunun içinde kalır', () => {
    const [e] = shapeStrokes('ellipse', [0, 0], [100, 50], { color: '#000', size: 3 }, id)
    expect(Math.max(...e.points.map((p) => p[0]))).toBeLessThanOrEqual(100)
    expect(Math.min(...e.points.map((p) => p[1]))).toBeGreaterThanOrEqual(0)
  })

  it('neredeyse yatay çizgiyi tam yataya oturtur, belirgin açıyı bozmaz', () => {
    expect(snapEnd([0, 0], [100, 4])[1]).toBeCloseTo(0, 5)
    const free = snapEnd([0, 0], [100, 30])
    expect(free).toEqual([100, 30])
  })

  it('zaman damgasını korur', () => {
    const [s] = shapeStrokes('line', [0, 0], [10, 10], { color: '#000', size: 2, t: 123 }, id)
    expect(s.t).toBe(123)
  })
})
