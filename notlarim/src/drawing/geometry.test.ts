import { describe, expect, it } from 'vitest'
import { pointInPolygon } from './geometry'

describe('kement seçimi', () => {
  const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
  it('içerideki noktayı bulur', () => expect(pointInPolygon(50, 50, square)).toBe(true))
  it('dışarıdaki noktayı dışarıda sayar', () => expect(pointInPolygon(150, 50, square)).toBe(false))
  it('içbükey şekillerde de doğru çalışır', () => {
    const u: [number, number][] = [[0, 0], [30, 0], [30, 70], [70, 70], [70, 0], [100, 0], [100, 100], [0, 100]]
    expect(pointInPolygon(50, 30, u)).toBe(false)
    expect(pointInPolygon(15, 30, u)).toBe(true)
  })
})
