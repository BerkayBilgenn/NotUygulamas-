export type ToastKind = 'info' | 'error' | 'success'
export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

type Listener = () => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((l) => l())
}

export const toastStore = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => toasts,
}

export function showToast(text: string, kind: ToastKind = 'info', ms = 4200) {
  const id = nextId++
  toasts = [...toasts, { id, kind, text }]
  notify()
  setTimeout(() => dismissToast(id), ms)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  notify()
}

/** Fired after a note is written to the database. */
export const savedBus = new EventTarget()
