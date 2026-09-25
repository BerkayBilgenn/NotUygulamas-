import { useState } from 'react'
import type { ReactNode } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import {
  AArrowDown,
  AArrowUp,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Omega,
  Subscript,
  Superscript,
  Table,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'
import { setSettings, useSettings } from '../state/settings'
import { pickFile } from '../lib/files'

function Btn({ on, label, active, disabled, children }: { on: () => void; label: string; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`fmt-btn ${active ? 'active' : ''}`}
      // Keep the editor focused (and the iPad keyboard open) while tapping buttons.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function TextToolbar({ editor, onImage }: { editor: Editor | null; onImage: (f: File) => void }) {
  const { textSize } = useSettings()
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            sub: e.isActive('subscript'),
            sup: e.isActive('superscript'),
            highlight: e.isActive('highlight'),
            h1: e.isActive('heading', { level: 1 }),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            task: e.isActive('taskList'),
            quote: e.isActive('blockquote'),
            table: e.isActive('table'),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  })
  if (!editor || !st) return <div className="fmt-bar" />
  const c = () => editor.chain().focus()
  const I = 19

  return (
    <div className="fmt-bar" role="toolbar" aria-label="Metin biçimi">
      <div className="fmt-scroll">
        <Btn on={() => c().undo().run()} label="Geri al" disabled={!st.canUndo}>
          <Undo2 size={I} />
        </Btn>
        <Btn on={() => c().redo().run()} label="Yinele" disabled={!st.canRedo}>
          <Redo2 size={I} />
        </Btn>
        <span className="fmt-sep" />
        <Btn on={() => c().toggleHeading({ level: 1 }).run()} label="Başlık 1" active={st.h1}>
          <Heading1 size={I} />
        </Btn>
        <Btn on={() => c().toggleHeading({ level: 2 }).run()} label="Başlık 2" active={st.h2}>
          <Heading2 size={I} />
        </Btn>
        <Btn on={() => c().toggleHeading({ level: 3 }).run()} label="Başlık 3" active={st.h3}>
          <Heading3 size={I} />
        </Btn>
        <span className="fmt-sep" />
        <Btn on={() => c().toggleBold().run()} label="Kalın" active={st.bold}>
          <Bold size={I} />
        </Btn>
        <Btn on={() => c().toggleItalic().run()} label="İtalik" active={st.italic}>
          <Italic size={I} />
        </Btn>
        <Btn on={() => c().toggleUnderline().run()} label="Altı çizili" active={st.underline}>
          <Underline size={I} />
        </Btn>
        <Btn on={() => c().toggleStrike().run()} label="Üstü çizili" active={st.strike}>
          <Strikethrough size={I} />
        </Btn>
        <Btn on={() => c().toggleHighlight().run()} label="Fosforlu" active={st.highlight}>
          <Highlighter size={I} />
        </Btn>
        <Btn on={() => c().toggleSubscript().run()} label="Alt simge (PaO₂)" active={st.sub}>
          <Subscript size={I} />
        </Btn>
        <Btn on={() => c().toggleSuperscript().run()} label="Üst simge (m²)" active={st.sup}>
          <Superscript size={I} />
        </Btn>
        <Btn on={() => setSymbolsOpen((o) => !o)} label="Semboller" active={symbolsOpen}>
          <Omega size={I} />
        </Btn>
        <span className="fmt-sep" />
        <Btn on={() => c().toggleTaskList().run()} label="Yapılacaklar listesi" active={st.task}>
          <ListChecks size={I} />
        </Btn>
        <Btn on={() => c().toggleBulletList().run()} label="Madde listesi" active={st.bullet}>
          <List size={I} />
        </Btn>
        <Btn on={() => c().toggleOrderedList().run()} label="Numaralı liste" active={st.ordered}>
          <ListOrdered size={I} />
        </Btn>
        <Btn on={() => c().toggleBlockquote().run()} label="Alıntı" active={st.quote}>
          <Quote size={I} />
        </Btn>
        <span className="fmt-sep" />
        <Btn
          on={async () => {
            const f = await pickFile('image/*')
            if (f) onImage(f)
          }}
          label="Resim ekle"
        >
          <ImagePlus size={I} />
        </Btn>
        <Btn on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Tablo ekle" active={st.table}>
          <Table size={I} />
        </Btn>
        <span className="fmt-sep" />
        <Btn on={() => setSettings({ textSize: Math.max(14, textSize - 2) })} label="Yazıyı küçült" disabled={textSize <= 14}>
          <AArrowDown size={I} />
        </Btn>
        <Btn on={() => setSettings({ textSize: Math.min(30, textSize + 2) })} label="Yazıyı büyüt" disabled={textSize >= 30}>
          <AArrowUp size={I} />
        </Btn>
      </div>
      {symbolsOpen && (
        <div className="fmt-scroll symbol-bar" role="toolbar" aria-label="Semboller">
          {SYMBOLS.map((sym) => (
            <button
              key={sym}
              type="button"
              className="symbol-btn"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => c().insertContent(sym).run()}
              aria-label={`${sym} ekle`}
            >
              {sym}
            </button>
          ))}
        </div>
      )}
      {st.table && (
        <div className="fmt-scroll table-bar" role="toolbar" aria-label="Tablo">
          <TextBtn on={() => c().addRowAfter().run()}>+ Satır</TextBtn>
          <TextBtn on={() => c().addColumnAfter().run()}>+ Sütun</TextBtn>
          <TextBtn on={() => c().deleteRow().run()}>− Satır</TextBtn>
          <TextBtn on={() => c().deleteColumn().run()}>− Sütun</TextBtn>
          <TextBtn on={() => c().toggleHeaderRow().run()}>Başlık satırı</TextBtn>
          <TextBtn on={() => c().deleteTable().run()} danger>
            Tabloyu sil
          </TextBtn>
        </div>
      )}
    </div>
  )
}

// Units and signs that come up constantly in perfusion / physiology notes.
const SYMBOLS = ['°', '±', 'µ', '×', '÷', '≈', '≠', '≤', '≥', '→', '←', '↑', '↓', '↔', 'Δ', 'α', 'β', 'γ', 'λ', 'π', 'Σ', 'Ω', '‰', '½', '¼', '·', '√', '∞', '✓']

function TextBtn({ on, children, danger }: { on: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`fmt-text-btn ${danger ? 'danger' : ''}`}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
    >
      {children}
    </button>
  )
}
