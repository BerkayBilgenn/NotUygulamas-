import 'fake-indexeddb/auto'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { NoteMeta, Page } from '../types'
import { drawingToPdf } from './drawingPdf'
import { textToPdf, type DocNode } from './textPdf'

const note = (over: Partial<NoteMeta>): NoteMeta => ({
  id: 'n',
  type: 'drawing',
  title: 'Kalp',
  folderId: null,
  tags: [],
  createdAt: 0,
  updatedAt: Date.UTC(2026, 8, 25),
  deletedAt: null,
  searchText: '',
  ...over,
})

const stroke = (tool: 'pen' | 'highlighter' = 'pen') => ({
  id: Math.random().toString(),
  tool,
  color: tool === 'pen' ? '#72243E' : '#FFE45C',
  size: tool === 'pen' ? 4 : 22,
  sp: false,
  points: [
    [100, 100, 0.5],
    [300, 140, 0.7],
    [500, 120, 0.4],
  ] as [number, number, number][],
})

beforeEach(async () => {
  await db.files.clear()
})

describe('çizimi PDF olarak dışa aktarma', () => {
  it('her defter sayfası bir PDF sayfası olur', async () => {
    const pages: Page[] = [
      { id: 'a', strokes: [stroke(), stroke('highlighter')] },
      { id: 'b', strokes: [], h: 563 },
    ]
    const bytes = await drawingToPdf(note({ paper: 'lined' }), pages)
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    const [w, h] = [pdf.getPage(1).getWidth(), pdf.getPage(1).getHeight()]
    expect(h / w).toBeCloseTo(0.563, 2)
  })

  it('PDF slaytlarını orijinal sayfa olarak kopyalar, araya eklenen sayfayı korur', async () => {
    const src = await PDFDocument.create()
    src.addPage([960, 540])
    src.addPage([960, 540])
    const srcBytes = await src.save()
    await db.files.add({ id: 'pdf1', noteId: 'n', mime: 'application/pdf', createdAt: 0, data: srcBytes.buffer.slice(0) as ArrayBuffer })
    const pages: Page[] = [
      { id: 'a', strokes: [stroke()], h: 563, bg: { kind: 'pdf', fileId: 'pdf1', page: 1 } },
      { id: 'blank', strokes: [stroke()], h: 563, paper: 'lined' },
      { id: 'b', strokes: [], h: 563, bg: { kind: 'pdf', fileId: 'pdf1', page: 2 } },
    ]
    const pdf = await PDFDocument.load(await drawingToPdf(note({ pdf: { name: 'x.pdf', pages: 2 } }), pages))
    expect(pdf.getPageCount()).toBe(3)
    expect(pdf.getPage(0).getWidth()).toBe(960)
    expect(pdf.getPage(2).getWidth()).toBe(960)
  })

  it('sonsuz tuvali tek sayfaya sığdırır', async () => {
    const pdf = await PDFDocument.load(await drawingToPdf(note({ drawMode: 'canvas', paper: 'grid' }), [{ id: 'c', strokes: [stroke()] }]))
    expect(pdf.getPageCount()).toBe(1)
  })
})

describe('yazılı notu PDF olarak dışa aktarma', () => {
  const doc: DocNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Kardiyopulmoner Bypass' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hedef PaO' },
          { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
          { type: 'text', text: ' 150–250 mmHg, BSA 1,8 m' },
          { type: 'text', text: '2', marks: [{ type: 'superscript' }] },
          { type: 'text', text: ' · akış ≈ 2,4 L/dk/m² → ısı 32 °C, ΔT ≤ 10', marks: [{ type: 'bold' }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heparin 300–400 IU/kg (ığdır şişe)' }] }] }] },
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ACT > 480 sn kontrol' }] }] }],
      },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: ['İlaç', 'Doz'].map((t) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) },
          { type: 'tableRow', content: ['Protamin', '1 mg / 100 IU heparin'].map((t) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) },
        ],
      },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Şişe değişiminde hava kabarcığı kontrolü!' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'Q = CI × BSA' }] },
      { type: 'horizontalRule' },
    ],
  }

  it('Türkçe karakterler, alt/üst simge, liste, tablo ve sembollerle PDF üretir', async () => {
    const bytes = await textToPdf(note({ type: 'text', title: 'Perfüzyon — ders 3' }), doc)
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toBe('Perfüzyon — ders 3')
  })

  it('uzun notu sayfalara böler', async () => {
    const long: DocNode = {
      type: 'doc',
      content: Array.from({ length: 120 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Satır ${i + 1}: oksijenatör, pompa, kanül, ısı değiştirici.` }] })),
    }
    const pdf = await PDFDocument.load(await textToPdf(note({ type: 'text' }), long))
    expect(pdf.getPageCount()).toBeGreaterThan(2)
  })

  it('boş notu da dışa aktarır', async () => {
    const pdf = await PDFDocument.load(await textToPdf(note({ type: 'text', title: '' }), { type: 'doc', content: [] }))
    expect(pdf.getPageCount()).toBe(1)
  })
})
