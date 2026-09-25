import { AnimatePresence, motion } from 'motion/react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Sparkle } from './Stars'

/** New versions never reload on their own: reloading mid-sentence would lose the caret and context. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    },
  })

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          className="update-prompt"
          role="status"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
        >
          <Sparkle size={16} color="var(--pink-2)" />
          <span>Yeni sürüm hazır</span>
          <button className="btn small primary" onClick={() => updateServiceWorker(true)}>
            Yenile
          </button>
          <button className="btn small ghost" onClick={() => setNeedRefresh(false)}>
            Sonra
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
