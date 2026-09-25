import type { PDFDocument, PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import nunito400 from '@fontsource/nunito/files/nunito-latin-400-normal.woff?inline'
import nunito400x from '@fontsource/nunito/files/nunito-latin-ext-400-normal.woff?inline'
import nunito700 from '@fontsource/nunito/files/nunito-latin-700-normal.woff?inline'
import nunito700x from '@fontsource/nunito/files/nunito-latin-ext-700-normal.woff?inline'
import nunito400i from '@fontsource/nunito/files/nunito-latin-400-italic.woff?inline'
import nunito400ix from '@fontsource/nunito/files/nunito-latin-ext-400-italic.woff?inline'
import nunito700i from '@fontsource/nunito/files/nunito-latin-700-italic.woff?inline'
import nunito700ix from '@fontsource/nunito/files/nunito-latin-ext-700-italic.woff?inline'
import fredoka600 from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff?inline'
import fredoka600x from '@fontsource/fredoka/files/fredoka-latin-ext-600-normal.woff?inline'
import symbols from '../assets/fonts/symbols.ttf?inline'

/**
 * The app's fonts are split into a basic-latin file and a latin-ext file
 * (ç ö ü in one, ğ ş İ in the other), plus a small symbol font for ₂ ≤ → Δ.
 * A FontStack picks the right file per character.
 */
export class FontStack {
  private fonts: PDFFont[]
  private sets: Set<number>[]
  constructor(fonts: PDFFont[]) {
    this.fonts = fonts
    this.sets = fonts.map((f) => new Set(f.getCharacterSet()))
  }
  fontFor(cp: number): PDFFont {
    for (let i = 0; i < this.fonts.length; i++) if (this.sets[i].has(cp)) return this.fonts[i]
    return this.fonts[0]
  }
  /** Splits text into pieces that each use one font. */
  segments(text: string): { font: PDFFont; text: string }[] {
    const out: { font: PDFFont; text: string }[] = []
    for (const ch of text) {
      const font = this.fontFor(ch.codePointAt(0)!)
      const last = out[out.length - 1]
      if (last && last.font === font) last.text += ch
      else out.push({ font, text: ch })
    }
    return out
  }
  width(text: string, size: number): number {
    let w = 0
    for (const s of this.segments(text)) {
      try {
        w += s.font.widthOfTextAtSize(s.text, size)
      } catch {
        w += size * 0.5 * s.text.length
      }
    }
    return w
  }
}

export interface Fonts {
  regular: FontStack
  bold: FontStack
  italic: FontStack
  boldItalic: FontStack
  heading: FontStack
}

function bytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit)
  const embed = (u: string) => doc.embedFont(bytes(u), { subset: true })
  const sym = await embed(symbols)
  const bold = [await embed(nunito700), await embed(nunito700x)]
  const stack = async (a: string, b: string) => new FontStack([await embed(a), await embed(b), sym])
  return {
    regular: await stack(nunito400, nunito400x),
    bold: new FontStack([...bold, sym]),
    italic: await stack(nunito400i, nunito400ix),
    boldItalic: await stack(nunito700i, nunito700ix),
    // Fredoka has no ğ, ş or İ; those letters fall back to bold Nunito, like in the app itself.
    heading: new FontStack([await embed(fredoka600), await embed(fredoka600x), ...bold, sym]),
  }
}
