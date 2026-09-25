import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { createDrawingNote, createFolder, createPdfNote, createTextNote, saveDrawing, saveFile, saveText, updateNote } from '../db/repo'
import { BackupError, buildBackup, parseBackup, restoreBackup } from './backup'

async function clearAll() {
  await Promise.all([db.folders.clear(), db.notes.clear(), db.texts.clear(), db.drawings.clear(), db.meta.clear(), db.files.clear(), db.recordings.clear()])
}

async function seed() {
  const folder = await createFolder('Anatomi')
  const t = await createTextNote(folder.id)
  await saveText(t, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kalp' }] }] }, 'Kalp')
  await updateNote(t, { title: 'Kalp notları', tags: ['vize'] })
  const d = await createDrawingNote(null, 'notebook', 'lined')
  await saveDrawing(d, [
    { id: 'p1', strokes: [{ id: 's1', tool: 'pen', color: '#72243E', size: 4, sp: false, points: [[1, 2, 0.5], [3, 4, 0.7]] }] },
    { id: 'p2', strokes: [] },
  ])
  return { folder, t, d }
}

describe('yedek', () => {
  beforeEach(clearAll)

  it('yedek alıp geri yükleyince veri birebir aynı çıkar', async () => {
    await seed()
    const before = await buildBackup()
    const json = JSON.stringify(before)
    await clearAll()
    const r = await restoreBackup(parseBackup(json))
    expect(r.added).toBe(2)
    const after = await buildBackup()
    const sort = <T extends { id?: string; noteId?: string }>(a: T[]) =>
      [...a].sort((x, y) => String(x.id ?? x.noteId).localeCompare(String(y.id ?? y.noteId)))
    expect(sort(after.data.notes)).toEqual(sort(before.data.notes))
    expect(sort(after.data.texts)).toEqual(sort(before.data.texts))
    expect(sort(after.data.drawings)).toEqual(sort(before.data.drawings))
    expect(after.data.folders).toEqual(before.data.folders)
  })

  it('PDF ve resimleri byte byte geri getirir', async () => {
    const pdfBytes = new Uint8Array(70000).map((_, i) => (i * 31) % 256)
    const noteId = await createPdfNote(null, 'Anatomi.pdf', pdfBytes.buffer.slice(0), [[960, 540], [960, 540]])
    const imgId = await saveFile(noteId, new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer, 'image/png', 'kalp.png')
    const json = JSON.stringify(await buildBackup())
    await clearAll()
    const r = await restoreBackup(parseBackup(json))
    expect(r.added).toBe(1)
    const pdf = (await db.files.where('noteId').equals(noteId).toArray()).find((f) => f.mime === 'application/pdf')!
    expect(new Uint8Array(pdf.data)).toEqual(pdfBytes)
    expect(Array.from(new Uint8Array((await db.files.get(imgId))!.data))).toEqual([137, 80, 78, 71, 1, 2, 3])
    const drawing = await db.drawings.get(noteId)
    expect(drawing?.pages.map((p) => p.h)).toEqual([563, 563])
    expect(drawing?.pages[1].bg).toEqual({ kind: 'pdf', fileId: pdf.id, page: 2 })
    expect((await db.notes.get(noteId))?.title).toBe('Anatomi')
  })

  it('ses kayıtlarını ve ses dosyasını geri getirir', async () => {
    const { t } = await seed()
    const fileId = await saveFile(t, new Uint8Array([9, 9, 9]).buffer, 'audio/mp4', 'ders-kaydi')
    await db.recordings.add({ id: 'rec1', noteId: t, fileId, startedAt: 1000, duration: 60000, mime: 'audio/mp4', status: 'done' })
    await db.recordings.add({ id: 'rec2', noteId: t, fileId: null, startedAt: 2000, duration: 0, mime: 'audio/mp4', status: 'recording' })
    const json = JSON.stringify(await buildBackup())
    await clearAll()
    await restoreBackup(parseBackup(json))
    expect((await db.recordings.toArray()).map((r) => r.id)).toEqual(['rec1'])
    expect(Array.from(new Uint8Array((await db.files.get(fileId))!.data))).toEqual([9, 9, 9])
  })

  it('tamamlanmış transkripti ses kaydıyla yedekler', async () => {
    const { t } = await seed()
    const fileId = await saveFile(t, new Uint8Array([1, 2, 3]).buffer, 'audio/mp4', 'ders-kaydi')
    await db.recordings.add({
      id: 'rec-transcript',
      noteId: t,
      fileId,
      startedAt: 1,
      duration: 1000,
      mime: 'audio/mp4',
      status: 'done',
      transcript: { status: 'done', text: 'Mitokondri enerji üretir.', language: 'tr', updatedAt: 2 },
    })

    const restored = parseBackup(JSON.stringify(await buildBackup()))

    expect(restored.version).toBe(4)
    expect(restored.data.recordings?.[0].transcript).toMatchObject({
      status: 'done',
      text: 'Mitokondri enerji üretir.',
      language: 'tr',
    })
  })

  it('eski (v1) yedekleri de açar', async () => {
    await seed()
    const b = await buildBackup()
    const v1 = { ...b, version: 1, data: { ...b.data, files: undefined } }
    await clearAll()
    const r = await restoreBackup(parseBackup(JSON.stringify(v1)))
    expect(r.added).toBe(2)
  })

  it('kalıcı silinen not dosyalarını da siler', async () => {
    const noteId = await createPdfNote(null, 'x.pdf', new ArrayBuffer(10), [[100, 100]])
    const { deleteNoteForever } = await import('../db/repo')
    await deleteNoteForever(noteId)
    expect(await db.files.where('noteId').equals(noteId).count()).toBe(0)
  })

  it('cihazdaki daha yeni notun üzerine yazmaz', async () => {
    const { t } = await seed()
    const old = await buildBackup()
    await new Promise((r) => setTimeout(r, 5))
    await updateNote(t, { title: 'Yeni başlık' })
    const r = await restoreBackup(old)
    expect(r.keptNewer).toBe(2)
    expect((await db.notes.get(t))?.title).toBe('Yeni başlık')
  })

  it('bozuk dosyada hiçbir şeye dokunmadan hata verir', async () => {
    await seed()
    const count = await db.notes.count()
    expect(() => parseBackup('{bozuk')).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ app: 'baska' }))).toThrow(BackupError)
    const bad = await buildBackup()
    ;(bad.data.notes[0] as unknown as { type: string }).type = 'video'
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(BackupError)
    expect(await db.notes.count()).toBe(count)
  })

  it('daha yeni sürümün yedeğini reddeder', async () => {
    const b = await buildBackup()
    expect(() => parseBackup(JSON.stringify({ ...b, version: 99 }))).toThrow(/daha yeni/)
  })
})
