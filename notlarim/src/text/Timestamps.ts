import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { activeRecording } from '../lib/recorder'

const TYPES = ['paragraph', 'heading', 'codeBlock']

/** Replay window for the note currently shown; set by the text editor while a recording plays. */
let replay: { from: number; to: number; now: number } | null = null
export function setReplayWindow(w: typeof replay) {
  replay = w
}

function hasOtherWithTs(doc: PMNode, ts: number, pos: number) {
  let found = false
  doc.descendants((node, p) => {
    if (found) return false
    if (p !== pos && node.attrs?.ts === ts) found = true
    return !node.isTextblock
  })
  return found
}

/**
 * While a lecture is being recorded, each paragraph the user types in gets the
 * time it was written. Later, tapping that paragraph jumps the recording there,
 * and during replay paragraphs written "in the future" are dimmed.
 */
export const Timestamps = Extension.create({
  name: 'timestamps',

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          ts: {
            default: null,
            // A paragraph split with Enter must not inherit the time of the one it came from.
            keepOnSplit: false,
            parseHTML: (el) => Number(el.getAttribute('data-ts')) || null,
            renderHTML: (attrs) => (attrs.ts ? { 'data-ts': String(attrs.ts) } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          const rec = activeRecording()
          if (!rec || !transactions.some((t) => t.docChanged && !t.getMeta('timestamps'))) return null
          const $head = state.selection.$head
          for (let d = $head.depth; d > 0; d--) {
            const node = $head.node(d)
            if (!TYPES.includes(node.type.name)) continue
            const pos = $head.before(d)
            const ts = node.attrs.ts as number | null
            // Keep the first moment it was written in this recording (unless it's a copy from a split).
            if (ts && ts >= rec.startedAt && !hasOtherWithTs(state.doc, ts, pos)) return null
            const tr = state.tr.setNodeAttribute(pos, 'ts', Date.now())
            tr.setMeta('timestamps', true).setMeta('addToHistory', false)
            return tr
          }
          return null
        },
        props: {
          decorations(state) {
            const w = replay
            if (!w) return null
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              const ts = node.attrs?.ts as number | null | undefined
              if (ts && ts >= w.from && ts <= w.to) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: ts > w.now ? 'ts-linked ts-future' : 'ts-linked' }))
              }
              return !node.isTextblock
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
