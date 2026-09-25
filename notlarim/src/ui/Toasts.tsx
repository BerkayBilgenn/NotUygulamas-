import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { dismissToast, toastStore } from '../lib/events'

export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.get)
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast toast-${t.kind}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
          >
            <span>{t.text}</span>
            <button className="icon-btn small" onClick={() => dismissToast(t.id)} aria-label="Kapat">
              <X size={16} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
