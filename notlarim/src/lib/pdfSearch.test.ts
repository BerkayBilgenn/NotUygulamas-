import { describe, expect, it } from 'vitest'
import type { Page, PdfText } from '../types'
import { searchPdf, snippetAround } from './pdfSearch'

const pdf: PdfText = {
  noteId: 'n',
  pages: [
    { t: 'Kalp Anatomisi Sağ atriyum', i: [['Kalp Anatomisi', 10, 10, 200, 20], ['Sağ atriyum', 10, 60, 120, 14]] },
    { t: 'Heparin ve PROTAMİN dozlaması', i: [['Heparin ve', 10, 10, 90, 14], ['PROTAMİN dozlaması', 110, 10, 160, 14]] },
    { t: 'Kardiyopulmoner bypass ve protamin', i: [['Kardiyopulmoner bypass ve protamin', 10, 10, 300, 14]] },
  ],
}
const bg = (page: number): Page => ({ id: `p${page}`, strokes: [], bg: { kind: 'pdf', fileId: 'f', page } })

describe('PDF içinde arama', () => {
  it('Türkçe büyük/küçük harf farkını gözetmeden bulur', () => {
    const hits = searchPdf(pdf, [bg(1), bg(2), bg(3)], 'protamin')
    expect(hits.map((h) => h.pdfPage)).toEqual([2, 3])
    expect(hits[0].rects).toEqual([[110, 10, 160, 14]])
  })

  it('araya eklenen boş sayfaları hesaba katıp doğru defter sayfasını verir', () => {
    const blank: Page = { id: 'b', strokes: [] }
    const hits = searchPdf(pdf, [bg(1), blank, bg(2), blank, bg(3)], 'protamin')
    expect(hits.map((h) => h.pageIndex)).toEqual([2, 4])
  })

  it('tüm kelimeler aynı slaytta olmalı', () => {
    expect(searchPdf(pdf, [bg(1), bg(2), bg(3)], 'heparin bypass')).toHaveLength(0)
    expect(searchPdf(pdf, [bg(1), bg(2), bg(3)], 'heparin doz')).toHaveLength(1)
  })

  it('silinen PDF sayfası sonuçlarda çıkmaz', () => {
    expect(searchPdf(pdf, [bg(1), bg(3)], 'protamin').map((h) => h.pdfPage)).toEqual([3])
  })

  it('eşleşmenin etrafından özet çıkarır', () => {
    const s = snippetAround('Kardiyopulmoner bypass ve protamin', 'bypass', 8)
    expect(s.match).toBe('bypass')
    expect(s.before.endsWith('oner ')).toBe(true)
  })
})
