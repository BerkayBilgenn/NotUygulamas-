import { describe, expect, it } from 'vitest'
import { matchesQuery, normalizeTag, normalizeTr } from './search'

const note = (title: string, searchText = '', tags: string[] = []) => ({ title, searchText, tags })

describe('Türkçe arama', () => {
  it('büyük I ve İ harflerini Türkçe kurallarla küçültür', () => {
    expect(normalizeTr('IŞIK')).toBe('ışık')
    expect(normalizeTr('İLAÇ')).toBe('ilaç')
  })

  it('büyük harfle yazılan sorgu küçük harfli metni bulur', () => {
    expect(matchesQuery(note('Kalp ışık refleksi'), 'IŞIK')).toBe(true)
    expect(matchesQuery(note('İlaç etkileşimleri'), 'ilaç')).toBe(true)
    expect(matchesQuery(note('ilaç etkileşimleri'), 'İLAÇ')).toBe(true)
  })

  it('"ı" ile "i" ayrı harf kabul edilir', () => {
    expect(matchesQuery(note('kısa not'), 'kisa')).toBe(false)
  })

  it('tüm kelimeler başlık, metin veya etiketlerde bulunmalı', () => {
    const n = note('Anatomi', 'kalbin odacıkları ve kapakçıklar', ['vize'])
    expect(matchesQuery(n, 'anatomi kapakçık')).toBe(true)
    expect(matchesQuery(n, 'vize odacık')).toBe(true)
    expect(matchesQuery(n, 'anatomi böbrek')).toBe(false)
  })

  it('boş sorgu her notu eşler', () => {
    expect(matchesQuery(note('x'), '   ')).toBe(true)
  })

  it('etiketleri normalleştirir', () => {
    expect(normalizeTag('  #İç Hastalıkları ')).toBe('iç-hastalıkları')
  })
})
