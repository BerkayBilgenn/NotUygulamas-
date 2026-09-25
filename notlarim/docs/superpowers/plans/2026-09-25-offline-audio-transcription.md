# Çevrimdışı Ses Transkripti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tamamlanmış ses kayıtlarını cihazdan çıkarmadan yazıya çeviren, transkripti kayıtla saklayan ve yazılı nota isteğe bağlı ekleyen akışı oluşturmak.

**Architecture:** Nicemlenmiş çok dilli Whisper Tiny, dinamik yüklenen `@huggingface/transformers` ile bir Web Worker içinde çalışır. Ana iş parçacığı yalnızca asenkron ses çözmeyi ve UI durumunu yönetir; 16 kHz dönüştürme, parçalama ve çıkarım Worker'da yapılır. Transkript durumu `Recording` üzerinde IndexedDB'ye yazılır ve mevcut yedekleme akışıyla taşınır.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Dexie 4, Vitest 5, `@huggingface/transformers`, Web Worker, Web Audio API, IndexedDB/Cache API.

**Spec:** `docs/superpowers/specs/2026-09-25-offline-audio-transcription-design.md`

## Global Constraints

- Ses ve transkript hiçbir uygulama sunucusuna veya üçüncü taraf inference API'sine gönderilmeyecek.
- Çok dilli Whisper Tiny model dosyaları yalnızca ilk kullanımda indirilecek ve sonraki kullanımlar için tarayıcıda önbelleklenecek.
- iOS/iPadOS'ta WASM/CPU kullanılacak; diğer cihazlarda WebGPU başarısız olursa iş bir kez WASM ile baştan denenecek.
- Aynı anda yalnızca bir transkripsiyon işi çalışacak.
- Transkripsiyon, metin editörünü ve çizim tuvalini bloke etmeyecek.
- Çizim notundaki transkript ses kaydında kalacak; otomatik yeni not oluşturulmayacak.
- Model ve çıkarım kodu başlangıç paketine dahil edilmeyecek.
- Mevcut ses kaydı ve oynatma davranışı korunacak.

## Review Focus

- 45+ dakikalık kayıt: ses 30 saniyelik parçalara ayrılmalı, parça sırası korunmalı ve çıkarım sırasında yalnızca etkin parçanın ek kopyası tutulmalı; Task 2 uzun-parça testi sınırları, Task 3 istemci testi aktarılabilir tamponların bırakılmasını sabitler.
- İki kayıtta art arda transkript isteği: ikinci iş reddedilmeli, ilk kayıt ve UI zarar görmemeli; Task 3 tek-iş testi bunu sabitler.
- Uygulama işlem sırasında kapanırsa: ses kaydı kalmalı, `processing` durumu yeniden denenebilir hataya dönmeli; Task 1 kurtarma testi bunu sabitler.
- Model önceden indirilmemişken çevrimdışı kullanım: kayıt zarar görmeden uygulanabilir hata gösterilmeli; Task 3 worker hata eşleme testi bunu sabitler.
- Çizim notunda “Nota ekle”: eylem hiç sunulmamalı, transkript yine kopyalanabilmeli; Task 4 görünür eylem testi bunu sabitler.

---

## Dosya Haritası

- `src/types.ts`: kalıcı transkript tipi ve `Recording.transcript` alanı.
- `src/db/db.ts`: Dexie v4 şeması ve yarım kalan transkript durumunun açılışta güvenli hale getirilmesi için sürüm sınırı.
- `src/lib/backup.ts`, `src/lib/backup.test.ts`: yedek sürümü, transkript doğrulama ve geriye uyumluluk.
- `src/transcription/audio.ts`, `src/transcription/audio.test.ts`: örnekleme, parça sınırları ve metin birleştirme saf fonksiyonları.
- `src/transcription/messages.ts`: ana iş parçacığı ile Worker arasındaki ayrık birleşim mesaj tipleri.
- `src/transcription/transcription.worker.ts`: model yükleme, cihaz seçimi, parça çıkarımı, ilerleme ve hata olayları.
- `src/transcription/client.ts`, `src/transcription/client.test.ts`: tek aktif iş, Worker yaşam döngüsü, IndexedDB güncellemeleri, iptal ve kurtarma.
- `src/ui/RecordingTranscript.tsx`: kayıt bazlı transkript UI'sı.
- `src/ui/RecordControl.tsx`: transkript UI'sını mevcut kayıt listesine bağlama.
- `src/lib/events.ts`: yazılı editöre transkript ekleme olayı.
- `src/text/TextEditor.tsx`: transkript ekleme olayını tek Tiptap transaction'ı olarak uygulama.
- `src/transcription/insert.ts`, `src/transcription/insert.test.ts`: eklenecek Tiptap JSON içeriğinin saf üretimi.
- `src/styles.css`: ilerleme, transkript gövdesi ve eylem düzeni.
- `package.json`, `package-lock.json`: Transformers.js bağımlılığı.
- `README.md`: çevrimdışı model indirme ve transkript kullanım bilgisi.

### Task 1: Kalıcı transkript verisi, kurtarma ve yedekleme

**Files:**
- Modify: `src/types.ts:95-109`
- Modify: `src/db/db.ts:4-37`
- Modify: `src/lib/backup.ts:1-160`
- Modify: `src/lib/backup.test.ts:1-120`
- Create: `src/lib/transcriptRecovery.ts`
- Create: `src/lib/transcriptRecovery.test.ts`

**Interfaces:**
- Produces: `RecordingTranscript`, `TranscriptErrorCode`, `recoverInterruptedTranscripts(): Promise<number>`.
- Produces: `Recording.transcript?: RecordingTranscript`; later tasks update only this nested value through `db.recordings.update`.

- [ ] **Step 1: Write failing backup and recovery tests**

```ts
it('tamamlanmış transkripti ses kaydıyla yedekler', async () => {
  await db.recordings.add({
    id: 'r1', noteId: t, fileId, startedAt: 1, duration: 1000,
    mime: 'audio/mp4', status: 'done',
    transcript: { status: 'done', text: 'Mitokondri enerji üretir.', language: 'tr', updatedAt: 2 },
  })
  const restored = parseBackup(JSON.stringify(await buildBackup()))
  expect(restored.version).toBe(4)
  expect(restored.data.recordings?.[0].transcript?.text).toBe('Mitokondri enerji üretir.')
})

it('yarım kalan transkripti yeniden denenebilir hataya çevirir', async () => {
  await db.recordings.add({ ...doneRecording, transcript: { status: 'processing', progress: 44, updatedAt: 2 } })
  expect(await recoverInterruptedTranscripts()).toBe(1)
  expect((await db.recordings.get(doneRecording.id))?.transcript).toMatchObject({ status: 'error', error: 'interrupted' })
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/backup.test.ts src/lib/transcriptRecovery.test.ts`  
Expected: FAIL because transcript types, backup v4 and recovery function do not exist.

- [ ] **Step 3: Add the persistent types and recovery implementation**

```ts
export type TranscriptErrorCode = 'model' | 'decode' | 'memory' | 'cancelled' | 'interrupted' | 'offline' | 'unknown'

export type RecordingTranscript =
  | { status: 'processing'; progress: number; updatedAt: number }
  | { status: 'done'; text: string; language?: string; updatedAt: number }
  | { status: 'error'; error: TranscriptErrorCode; updatedAt: number }
```

Set `BACKUP_VERSION = 4`, validate transcript shapes without rejecting v1-v3 backups, and implement:

```ts
export async function recoverInterruptedTranscripts(): Promise<number> {
  const rows = (await db.recordings.toArray()).filter((r) => r.transcript?.status === 'processing')
  await db.transaction('rw', db.recordings, async () => {
    for (const r of rows) await db.recordings.update(r.id, { transcript: { status: 'error', error: 'interrupted', updatedAt: Date.now() } })
  })
  return rows.length
}
```

Add `this.version(4).stores({})` to document the application schema boundary without changing indexes.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- src/lib/backup.test.ts src/lib/transcriptRecovery.test.ts`  
Expected: all focused tests PASS, including existing v1 backup compatibility.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/db/db.ts src/lib/backup.ts src/lib/backup.test.ts src/lib/transcriptRecovery.ts src/lib/transcriptRecovery.test.ts
git commit -m "feat: persist recording transcripts"
```

### Task 2: Ses dönüştürme, parçalama ve sonuç birleştirme

**Files:**
- Create: `src/transcription/audio.ts`
- Create: `src/transcription/audio.test.ts`

**Interfaces:**
- Produces: `downmixAndResample(channels: Float32Array[], sourceRate: number, targetRate?: number): Float32Array`.
- Produces: `splitAudio(samples: Float32Array, sampleRate?: number, seconds?: number, overlapSeconds?: number): AudioSegment[]`.
- Produces: `mergeTranscriptParts(parts: string[]): string`.
- `AudioSegment = { index: number; startSample: number; samples: Float32Array }` is consumed by Task 3.

- [ ] **Step 1: Write failing DSP and long-recording tests**

```ts
it('stereoyu mono 16 kHz örneklere dönüştürür', () => {
  const out = downmixAndResample([new Float32Array([1, 0, -1, 0]), new Float32Array([0, 1, 0, -1])], 32_000)
  expect(out.length).toBe(2)
  expect(Array.from(out)).toEqual([0.5, -0.5])
})

it('45 dakikayı sabit boyutlu ve sıralı parçalara böler', () => {
  // 10 Hz örnek oranı aynı zaman sınırlarını çok az test belleğiyle doğrular.
  const out = splitAudio(new Float32Array(10 * 60 * 45), 10, 30, 1)
  expect(out.length).toBeGreaterThan(90)
  expect(out.every((x, i) => x.index === i && x.samples.length <= 10 * 30)).toBe(true)
})

it('örtüşen kelimeleri bir kez bırakır', () => {
  expect(mergeTranscriptParts(['Hücrenin enerji merkezi mitokondridir', 'enerji merkezi mitokondridir ve ATP üretir']))
    .toBe('Hücrenin enerji merkezi mitokondridir ve ATP üretir')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/transcription/audio.test.ts`  
Expected: FAIL because `audio.ts` does not exist.

- [ ] **Step 3: Implement deterministic helpers**

Use linear interpolation for resampling, average all channels before resampling, create 30-second views with a 1-second overlap, and merge adjacent parts by finding the longest normalized suffix/prefix match of at least three words. Return new arrays only for the segment currently sent to inference so callers can release completed buffers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/transcription/audio.test.ts`  
Expected: all audio helper tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transcription/audio.ts src/transcription/audio.test.ts
git commit -m "feat: prepare audio for offline transcription"
```

### Task 3: Worker protokolü ve tek aktif transkripsiyon istemcisi

**Files:**
- Create: `src/transcription/messages.ts`
- Create: `src/transcription/transcription.worker.ts`
- Create: `src/transcription/client.ts`
- Create: `src/transcription/client.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 `RecordingTranscript`; Task 2 `downmixAndResample`, `splitAudio`, `mergeTranscriptParts`.
- Produces: `startTranscription(recording: Recording): Promise<void>`, `cancelTranscription(recId: string): void`, `useTranscriptionJob(): TranscriptionJobState`.
- Produces worker requests `{ type: 'transcribe'; recId; channels; sampleRate; platform } | { type: 'cancel'; recId }` and progress/result/error responses.

- [ ] **Step 1: Install the browser inference dependency**

Run: `npm install @huggingface/transformers`  
Expected: dependency and lockfile update; do not import it from the main React bundle.

- [ ] **Step 2: Write failing client tests with an injected fake Worker**

```ts
it('ikinci eşzamanlı işi reddeder', async () => {
  const first = startTranscription(r1, { createWorker: fakeWorkerFactory })
  await expect(startTranscription(r2, { createWorker: fakeWorkerFactory })).rejects.toThrow('TRANSCRIPTION_BUSY')
  fakeWorker.emit({ type: 'complete', recId: r1.id, text: 'tamam', language: 'tr' })
  await first
})

it('model çevrimdışı ve önbelleksizse kaydı koruyup offline hatası yazar', async () => {
  const job = startTranscription(r1, { createWorker: offlineWorkerFactory })
  await expect(job).rejects.toThrow()
  expect((await db.recordings.get(r1.id))?.fileId).toBe(r1.fileId)
  expect((await db.recordings.get(r1.id))?.transcript).toMatchObject({ status: 'error', error: 'offline' })
})

it('kanal tamponlarını Worker aktarım listesine verir', async () => {
  await startTranscription(r1, { createWorker: transferSpyWorkerFactory })
  expect(transferSpy.transferList).toEqual(expect.arrayContaining([expect.any(ArrayBuffer)]))
})
```

- [ ] **Step 3: Run the client tests and verify RED**

Run: `npm test -- src/transcription/client.test.ts`  
Expected: FAIL because the client and message protocol do not exist.

- [ ] **Step 4: Implement the typed protocol and coordinator**

The client reads `recording.fileId`, decodes the Blob with `AudioContext.decodeAudioData`, transfers channel buffers to the Worker, throttles persistent progress writes to at most once per second, terminates the Worker on completion/error/cancel, and resets the singleton job in `finally`.

Map errors exactly:

```ts
const ERROR_CODES: Record<string, TranscriptErrorCode> = {
  MODEL_DOWNLOAD_FAILED: navigator.onLine ? 'model' : 'offline',
  AUDIO_DECODE_FAILED: 'decode',
  OUT_OF_MEMORY: 'memory',
  CANCELLED: 'cancelled',
}
```

Accept a `createWorker` dependency in tests; production defaults to:

```ts
() => new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' })
```

- [ ] **Step 5: Implement Worker model loading and inference**

Define `MODEL_ID = 'onnx-community/whisper-tiny'`. Lazily import `@huggingface/transformers`, set `env.allowRemoteModels = true`, leave browser caching enabled, and construct an automatic-speech-recognition pipeline. Use WASM when `/iPad|iPhone|iPod/.test(navigator.userAgent)`; otherwise attempt WebGPU and retry the entire job once with WASM after a WebGPU failure. Pass `language: 'turkish'`, `task: 'transcribe'`, and `return_timestamps: false`; process Task 2 segments sequentially and post monotonic progress.

- [ ] **Step 6: Run client tests and verify GREEN**

Run: `npm test -- src/transcription/client.test.ts src/transcription/audio.test.ts`  
Expected: all focused tests PASS; fake Worker proves busy, progress, completion, offline error and cancel paths.

- [ ] **Step 7: Verify code splitting**

Run: `npm run build`  
Expected: production build PASS; Transformers/ONNX code appears in worker/dynamic chunks and the main `index-*.js` does not absorb model weights.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/transcription/messages.ts src/transcription/transcription.worker.ts src/transcription/client.ts src/transcription/client.test.ts
git commit -m "feat: transcribe recordings on device"
```

### Task 4: Transkript arayüzü ve yazılı nota ekleme

**Files:**
- Create: `src/transcription/insert.ts`
- Create: `src/transcription/insert.test.ts`
- Create: `src/ui/RecordingTranscript.tsx`
- Modify: `src/ui/RecordControl.tsx:1-110`
- Modify: `src/lib/events.ts:1-35`
- Modify: `src/text/TextEditor.tsx:1-150`
- Modify: `src/styles.css:1537-1700`

**Interfaces:**
- Consumes: Task 3 transcription client and Task 1 transcript data.
- Produces: `buildTranscriptContent(text: string, startedAt: number): JSONContent[]`.
- Produces: `transcriptInsertBus`, dispatch detail `{ noteId: string; text: string; startedAt: number }`.

- [ ] **Step 1: Write failing insertion and action-visibility tests**

```ts
it('transkripti tarih başlığı ve paragrafla üretir', () => {
  const content = buildTranscriptContent('Birinci bölüm\nİkinci bölüm', Date.UTC(2026, 8, 25, 11, 30))
  expect(content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
  expect(content.flatMap((n) => n.content ?? []).map((n) => n.text).join(' ')).toContain('Birinci bölüm')
})

it('çizim notunda nota ekle eylemini gizler', () => {
  expect(transcriptActions('drawing', { status: 'done', text: 'x', updatedAt: 1 })).toEqual(['copy', 'retry'])
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/transcription/insert.test.ts`  
Expected: FAIL because insertion helpers do not exist.

- [ ] **Step 3: Implement pure insertion helpers**

`buildTranscriptContent` returns one level-2 heading and one paragraph per non-empty line. Export `transcriptActions(noteType, transcript)` so visibility rules are testable without a DOM environment.

- [ ] **Step 4: Add the editor insertion event**

Create `transcriptInsertBus = new EventTarget()` in `events.ts`. In `TextEditorInner`, subscribe in an effect, ignore other note IDs, then run one chain:

```ts
editor.chain().focus('end').insertContent(buildTranscriptContent(text, startedAt)).run()
```

The normal `onUpdate` path marks the editor dirty and persists the change.

- [ ] **Step 5: Build `RecordingTranscript` and integrate it**

Render these exact states and labels:

- no transcript: **Transkript oluştur**
- model progress: **Model indiriliyor · %N**
- inference progress: **Yazıya çevriliyor · %N** plus **İptal**
- done: collapsible text plus **Kopyala**, text notes only **Nota ekle**, and **Yeniden oluştur**
- error: user-facing error text plus **Tekrar dene**

Use `navigator.clipboard.writeText`, existing `showToast`, and a confirmation before replacing a completed transcript. Add the component under each existing recording row without changing playback and delete controls.

- [ ] **Step 6: Style for touch and long content**

Keep action hit areas at least 44px on iPad, clamp the collapsed preview, allow the expanded transcript to scroll, and use existing color/radius tokens. Progress must be textual as well as visual so it is not color-only.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `npm test -- src/transcription/insert.test.ts src/transcription/client.test.ts`  
Expected: all tests PASS, including drawing-note action visibility.

- [ ] **Step 8: Commit**

```bash
git add src/transcription/insert.ts src/transcription/insert.test.ts src/ui/RecordingTranscript.tsx src/ui/RecordControl.tsx src/lib/events.ts src/text/TextEditor.tsx src/styles.css
git commit -m "feat: add recording transcript controls"
```

### Task 5: Uygulama başlangıcı, çevrimdışı davranış ve dokümantasyon

**Files:**
- Modify: `src/App.tsx:35-55`
- Modify: `vite.config.ts:1-70`
- Modify: `README.md:1-85`
- Modify: `src/lib/transcriptRecovery.test.ts`

**Interfaces:**
- Consumes: Task 1 `recoverInterruptedTranscripts`.
- Produces no new cross-task interfaces.

- [ ] **Step 1: Add the startup recovery regression test**

Extend recovery tests to assert that `done` and existing `error` transcripts are unchanged while only `processing` becomes `interrupted`.

- [ ] **Step 2: Run the recovery test and verify it fails if behavior is incomplete**

Run: `npm test -- src/lib/transcriptRecovery.test.ts`  
Expected: PASS only when recovery is selective and idempotent.

- [ ] **Step 3: Wire recovery into startup**

Call `recoverInterruptedTranscripts()` beside existing `recoverRecordings()` handling. Do not show a success toast; show an informational toast only when one or more jobs were recovered.

- [ ] **Step 4: Preserve lazy model caching in PWA configuration**

Do not add model weights to Workbox precache or raise the 5 MB precache limit. Document that Transformers.js/Cache API stores the on-demand model and add a manual offline check: transcribe once online, close the app, enable airplane mode, reopen from the home screen, and transcribe a second short recording.

- [ ] **Step 5: Update README**

Add usage notes for first model download, device-only processing, expected slower-than-real-time behavior on iPad, cancellation, and the offline-after-first-download rule.

- [ ] **Step 6: Run the complete automated suite**

Run: `npm test`  
Expected: all tests PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx vite.config.ts README.md src/lib/transcriptRecovery.test.ts
git commit -m "docs: explain offline transcription"
```

### Task 6: Son doğrulama, push ve production kontrolü

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes the complete feature from Tasks 1-5.
- Produces a tested Git commit series and verified Vercel production deployment.

- [ ] **Step 1: Run final automated verification**

Run: `npm test && npm run build`  
Expected: tests report zero failures; TypeScript and Vite production build exit 0.

- [ ] **Step 2: Run source-scoped lint**

Run: `npx oxlint src`  
Expected: no new errors. Record existing React warnings separately. Do not use the repository-wide `npm run lint` result as the source gate because the current repository lacks ignore configuration and scans `node_modules`.

- [ ] **Step 3: Exercise the local browser flow**

Run: `npm run dev -- --host 127.0.0.1`  
Expected: create a short text-note recording; transcribe; expand/copy/add; reload; confirm transcript persistence. Create a drawing-note recording and confirm **Nota ekle** is absent. Cancel one in-progress job and confirm the audio remains playable.

- [ ] **Step 4: Check Git scope**

Run: `git status --short && git diff --check && git log --oneline origin/main..HEAD`  
Expected: only planned product, test, doc and lockfile changes are committed; `.npm-cache`, `node_modules`, and `dist` are not staged.

- [ ] **Step 5: Push the approved implementation**

Run: `git push origin main`  
Expected: push succeeds and the Vercel-linked repository creates a new production deployment.

- [ ] **Step 6: Verify Vercel deployment**

Run: `npx --yes vercel@latest inspect --scope berkaybilgenn <new-deployment-url>` and `curl -sS -I https://not-uygulamas-67wu.vercel.app/`  
Expected: deployment status `Ready`; canonical URL returns `HTTP 200`.

- [ ] **Step 7: Perform the real-iPad acceptance checklist**

On the installed PWA: transcribe a short Turkish recording, confirm model reuse in airplane mode, start a long recording transcript and continue writing/drawing, cancel once, and force-close/reopen during processing. Expected: no lost audio or note data, UI remains responsive, and interrupted work offers retry. If a physical iPad is unavailable during implementation, report this checklist as the sole unverified item instead of claiming it passed.
