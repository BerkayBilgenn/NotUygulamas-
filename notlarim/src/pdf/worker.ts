import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// Normal build: PDF parsing runs in a Web Worker so drawing never stutters.
GlobalWorkerOptions.workerSrc = workerUrl
