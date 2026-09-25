import { rgb, type RGB } from 'pdf-lib'

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export const C = {
  burgundy: hexToRgb('#72243E'),
  ink: hexToRgb('#3B1624'),
  muted: hexToRgb('#95667A'),
  pink: hexToRgb('#D4537E'),
  line: hexToRgb('#F3C9D7'),
  grid: hexToRgb('#F6DCE5'),
  margin: hexToRgb('#ED93B1'),
  soft: hexToRgb('#FBEAF0'),
  highlight: hexToRgb('#FFE45C'),
  white: rgb(1, 1, 1),
}
