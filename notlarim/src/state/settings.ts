import { useSyncExternalStore } from 'react'

export type ToolName = 'pen' | 'highlighter' | 'eraser' | 'shape' | 'lasso'
export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse'
export type Edge = 'top' | 'bottom' | 'left' | 'right'

export interface Settings {
  textSize: number
  fingerDraw: boolean
  tool: ToolName
  eraserMode: 'stroke' | 'pixel'
  shapeKind: ShapeKind
  penColor: string
  penSize: number
  hlColor: string
  hlSize: number
  eraserSize: number
  toolbarEdge: Edge
  toolbarCollapsed: boolean
}

const DEFAULTS: Settings = {
  textSize: 18,
  fingerDraw: false,
  tool: 'pen',
  eraserMode: 'stroke',
  shapeKind: 'arrow',
  penColor: '#72243E',
  penSize: 4,
  hlColor: '#FFE45C',
  hlSize: 22,
  eraserSize: 14,
  toolbarEdge: 'top',
  toolbarCollapsed: false,
}

const KEY = 'notlarim.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* private mode or corrupted value: fall back to defaults */
  }
  return DEFAULTS
}

let state: Settings = load()
const listeners = new Set<() => void>()

export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function getSettings() {
  return state
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Small UI state that should survive reloads (last note, tab, folder). */
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const full = 'notlarim.ui.' + key
  const read = (): T => {
    try {
      const raw = localStorage.getItem(full)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  }
  const value = useSyncExternalStore(
    (l) => {
      const h = (e: Event) => {
        if ((e as CustomEvent).detail === full) l()
      }
      window.addEventListener('notlarim-ui', h)
      return () => window.removeEventListener('notlarim-ui', h)
    },
    () => localStorage.getItem(full),
  )
  void value
  const set = (v: T) => {
    try {
      localStorage.setItem(full, JSON.stringify(v))
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('notlarim-ui', { detail: full }))
  }
  return [read(), set]
}
