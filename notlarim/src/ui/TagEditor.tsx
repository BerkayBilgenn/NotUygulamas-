import { useState } from 'react'
import { X } from 'lucide-react'
import { normalizeTag } from '../lib/search'

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const parts = raw.split(',').map(normalizeTag).filter(Boolean)
    if (!parts.length) return
    const next = [...tags]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setDraft('')
  }

  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {tags.map((t) => (
          <span key={t} className="chip">
            #{t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`${t} etiketini kaldır`}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="input small"
        value={draft}
        placeholder="Etiket ekle, Enter'a bas"
        enterKeyHint="done"
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) add(v)
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  )
}
