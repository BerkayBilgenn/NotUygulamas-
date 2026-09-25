import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Timestamps, setReplayWindow } from './Timestamps'
import { db } from '../db/db'
import { saveFile, saveText } from '../db/repo'
import { showToast, transcriptInsertBus, type TranscriptInsertDetail } from '../lib/events'
import { prepareImage } from '../lib/files'
import { registerFlush } from '../lib/flush'
import { seekToWritten, usePlayback } from '../lib/playback'
import { NoteImage } from './ImageNode'
import { useSettings } from '../state/settings'
import type { NoteMeta } from '../types'
import { buildTranscriptContent } from '../transcription/insert'
import { TextToolbar } from './TextToolbar'

export function TextEditor({ note }: { note: NoteMeta }) {
  const [doc, setDoc] = useState<JSONContent | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    db.texts.get(note.id).then((t) => {
      if (alive) setDoc((t?.doc as JSONContent | undefined) ?? null)
    })
    return () => {
      alive = false
    }
  }, [note.id])

  if (doc === undefined) return <div className="loading-note" aria-busy="true" />
  return <TextEditorInner noteId={note.id} initialDoc={doc} />
}

function TextEditorInner({ noteId, initialDoc }: { noteId: string; initialDoc: JSONContent | null }) {
  const { textSize } = useSettings()
  const editorRef = useRef<Editor | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const flush = async () => {
    window.clearTimeout(timer.current)
    const ed = editorRef.current
    if (!dirty.current || !ed || ed.isDestroyed) return
    dirty.current = false
    await saveText(noteId, ed.getJSON(), ed.getText({ blockSeparator: '\n' })).catch(() => {
      dirty.current = true
    })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  const insertImage = async (file: File) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const img = await prepareImage(file, 1600)
      const fileId = await saveFile(noteId, img.data, img.mime, file.name)
      ed.chain().focus().insertContent({ type: 'image', attrs: { fileId, alt: file.name, width: img.width < 500 ? 60 : 100 } }).run()
    } catch (e) {
      console.error(e)
      showToast('Resim eklenemedi. Başka bir resim dene.', 'error')
    }
  }
  const insertImageRef = useRef(insertImage)
  insertImageRef.current = insertImage

  const isEmpty = !initialDoc || JSON.stringify(initialDoc).length < 60

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: 'Yazmaya başla…' }),
      NoteImage,
      TableKit.configure({ table: { resizable: false } }),
      Subscript,
      Superscript,
      Timestamps,
    ],
    content: initialDoc ?? '',
    autofocus: isEmpty ? 'end' : false,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Not metni' },
      // Pasted or dropped pictures are stored as files instead of huge inline data.
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files)
        if (!files.length) return false
        files.forEach((f) => insertImageRef.current(f))
        return true
      },
      handleDrop: (_view, event) => {
        const files = imageFiles((event as DragEvent).dataTransfer?.files)
        if (!files.length) return false
        event.preventDefault()
        files.forEach((f) => insertImageRef.current(f))
        return true
      },
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed
    },
    onUpdate: () => {
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flushRef.current(), 600)
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const insertTranscript = (event: Event) => {
      const { noteId: targetNoteId, text, startedAt } = (event as CustomEvent<TranscriptInsertDetail>).detail
      if (targetNoteId !== noteId) return
      editor.chain().focus('end').insertContent(buildTranscriptContent(text, startedAt)).run()
    }
    transcriptInsertBus.addEventListener('insert', insertTranscript)
    return () => transcriptInsertBus.removeEventListener('insert', insertTranscript)
  }, [editor, noteId])

  useEffect(() => registerFlush(() => flushRef.current()), [])

  // Audio replay: tap a paragraph to hear that moment; paragraphs written later are dimmed.
  const playback = usePlayback()
  const replayRec = playback.rec && playback.rec.noteId === noteId ? playback.rec : null
  const seekMode = !!replayRec && playback.sync
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setReplayWindow(replayRec ? { from: replayRec.startedAt, to: replayRec.startedAt + replayRec.duration, now: replayRec.startedAt + playback.currentMs } : null)
    const ed = editorRef.current
    // An empty transaction just makes ProseMirror redraw the replay decorations.
    if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta('addToHistory', false).setMeta('replayTick', true))
  }, [replayRec, playback.currentMs])
  useEffect(() => () => setReplayWindow(null), [])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushRef.current()
    }
    const onHide = () => void flushRef.current()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      // Save before the editor instance is destroyed.
      void flushRef.current()
    }
  }, [])

  return (
    <div className="text-editor" style={{ '--text-size': `${textSize}px` } as CSSProperties}>
      <TextToolbar editor={editor} onImage={(f) => insertImageRef.current(f)} />
      <div
        className={`text-scroll ${seekMode ? 'seek-mode' : ''}`}
        ref={scrollRef}
        onClickCapture={(e) => {
          if (!seekMode) return
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ts]')
          if (el?.dataset.ts) void seekToWritten(noteId, Number(el.dataset.ts))
        }}
      >
        <EditorContent editor={editor} className="text-content" />
      </div>
    </div>
  )
}

function imageFiles(list: FileList | undefined | null): File[] {
  return list ? Array.from(list).filter((f) => f.type.startsWith('image/')) : []
}
