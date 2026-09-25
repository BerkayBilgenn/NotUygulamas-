// The minifier writes "\uFFFD" escapes from bundled libraries (pdf.js, fontkit) as the raw
// replacement character. Some hosts reject files containing it, so turn them back into escapes.
// Every occurrence sits inside a JS string or template literal, where the escape means the same.
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2] ?? 'dist-single/index.html'
const src = readFileSync(file, 'utf8')
const count = src.split('\uFFFD').length - 1
writeFileSync(file, src.replaceAll('\uFFFD', '\\uFFFD'))
console.log(`escaped ${count} U+FFFD characters in ${file}`)
