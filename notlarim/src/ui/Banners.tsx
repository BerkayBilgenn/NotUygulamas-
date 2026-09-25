import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { HardDriveDownload, Smartphone, X } from 'lucide-react'
import { db } from '../db/db'
import { setMeta } from '../db/repo'
import { exportBackup } from '../lib/backupActions'
import type { NoteMeta } from '../types'
import { isStandalone } from './hooks'

const DAY = 24 * 60 * 60 * 1000

export function useBackupDue(notes: NoteMeta[] | undefined): boolean {
  const meta = useLiveQuery(async () => {
    const [last, snooze] = await Promise.all([db.meta.get('lastBackupAt'), db.meta.get('backupSnoozeUntil')])
    return { last: (last?.value as number | undefined) ?? 0, snooze: (snooze?.value as number | undefined) ?? 0 }
  }, [])
  if (!notes || !meta) return false
  const active = notes.filter((n) => !n.deletedAt)
  if (!active.length || Date.now() < meta.snooze) return false
  const since = meta.last || Math.min(...active.map((n) => n.createdAt))
  return Date.now() - since > 7 * DAY
}

export function usePersistence() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!navigator.storage?.persisted) return
      let p = await navigator.storage.persisted()
      if (!p && navigator.storage.persist) p = await navigator.storage.persist()
      if (alive) setPersisted(p)
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return persisted
}

export function Banners({ notes }: { notes: NoteMeta[] | undefined }) {
  const backupDue = useBackupDue(notes)
  const persisted = usePersistence()
  const [hidePersist, setHidePersist] = useState(() => localStorage.getItem('notlarim.hidePersist') === '1')
  const showPersist = persisted === false && !isStandalone() && !hidePersist

  return (
    <div className="banners">
      <AnimatePresence initial={false}>
        {backupDue && (
          <motion.div key="backup" className="banner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="banner-inner">
              <HardDriveDownload size={18} className="banner-icon" />
              <p>Son yedeğin üzerinden 7 günden fazla geçti.</p>
              <div className="banner-actions">
                <button className="btn small primary" onClick={() => exportBackup()}>
                  Yedek al
                </button>
                <button className="btn small ghost" onClick={() => setMeta('backupSnoozeUntil', Date.now() + DAY)}>
                  Yarın hatırlat
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {showPersist && (
          <motion.div key="persist" className="banner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="banner-inner">
              <Smartphone size={18} className="banner-icon" />
              <p>
                Notlarının kalıcı olması için uygulamayı ana ekrana ekle: Safari'de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b>.
              </p>
              <button
                className="icon-btn small"
                aria-label="Kapat"
                onClick={() => {
                  localStorage.setItem('notlarim.hidePersist', '1')
                  setHidePersist(true)
                }}
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
