// Single-file preview build: no separate worker file can be loaded, so pdf.js
// runs on the main thread (it picks up globalThis.pdfjsWorker set by this import).
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
