import { useEffect, useState } from 'react'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { fileUrl } from '../lib/files'

const WIDTHS = [
  { v: 35, label: 'Küçük' },
  { v: 60, label: 'Orta' },
  { v: 100, label: 'Tam' },
]

function ImageView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const fileId = node.attrs.fileId as string | null
  const [src, setSrc] = useState<string | null>(fileId ? null : (node.attrs.src as string | null))
  const width = (node.attrs.width as number | null) ?? 100

  useEffect(() => {
    if (!fileId) return
    let alive = true
    fileUrl(fileId).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [fileId])

  return (
    <NodeViewWrapper className={`note-image ${selected ? 'selected' : ''}`} data-drag-handle="">
      <div className="note-image-frame" style={{ width: `${width}%` }}>
        {src ? <img src={src} alt={(node.attrs.alt as string) || ''} draggable={false} /> : <div className="note-image-missing">Resim yükleniyor…</div>}
        {selected && (
          <div className="note-image-sizes" contentEditable={false}>
            {WIDTHS.map((w) => (
              <button
                key={w.v}
                type="button"
                className={width === w.v ? 'on' : ''}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ width: w.v })}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * Images in text notes. The bytes live in the files table (fileId); the note
 * document only keeps the reference, so typing never re-saves megabytes.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-file-id'),
        renderHTML: (attrs) => (attrs.fileId ? { 'data-file-id': attrs.fileId } : {}),
      },
      width: {
        default: 100,
        parseHTML: (el) => Number(el.getAttribute('data-width')) || 100,
        renderHTML: (attrs) => ({ 'data-width': attrs.width }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
}).configure({ inline: false, allowBase64: false })
