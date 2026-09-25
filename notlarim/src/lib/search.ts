import type { NoteMeta } from '../types'

/** Lowercase with Turkish rules (I → ı, İ → i) so "IŞIK" finds "ışık". */
export function normalizeTr(s: string): string {
  return s.toLocaleLowerCase('tr-TR').normalize('NFC')
}

export function matchesQuery(note: Pick<NoteMeta, 'title' | 'searchText' | 'tags'>, query: string): boolean {
  const q = normalizeTr(query).trim()
  if (!q) return true
  const hay = normalizeTr([note.title, note.tags.join(' '), note.searchText].join('\n'))
  return q.split(/\s+/).every((token) => hay.includes(token))
}

export function normalizeTag(tag: string): string {
  return normalizeTr(tag.trim().replace(/^#/, '')).replace(/\s+/g, '-')
}
