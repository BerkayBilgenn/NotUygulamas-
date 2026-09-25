import { describe, expect, it } from 'vitest'
import { buildTranscriptContent, transcriptActions } from './insert'

describe('transkripti nota ekleme', () => {
  it('transkripti tarih başlığı ve paragrafla üretir', () => {
    const content = buildTranscriptContent('Birinci bölüm\nİkinci bölüm', Date.UTC(2026, 8, 25, 11, 30))

    expect(content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(content.flatMap((node) => node.content ?? []).map((node) => node.text).join(' ')).toContain('Birinci bölüm')
    expect(content.filter((node) => node.type === 'paragraph')).toHaveLength(2)
  })

  it('çizim notunda nota ekle eylemini gizler', () => {
    expect(transcriptActions('drawing', { status: 'done', text: 'x', updatedAt: 1 })).toEqual(['copy', 'retry'])
  })

  it('yazılı notta nota ekle eylemini gösterir', () => {
    expect(transcriptActions('text', { status: 'done', text: 'x', updatedAt: 1 })).toEqual(['copy', 'insert', 'retry'])
  })
})
