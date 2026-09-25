import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { Download, Upload, X } from 'lucide-react'
import { db } from '../db/db'
import { exportBackup, importBackupFile } from '../lib/backupActions'
import { setSettings, useSettings } from '../state/settings'
import { isStandalone, relativeDate } from './hooks'
import { Sparkle } from './Stars'

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const lastBackup = useLiveQuery(async () => ((await db.meta.get('lastBackupAt'))?.value as number | undefined) ?? 0, [])
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null)

  useEffect(() => {
    ;(async () => {
      const est = await navigator.storage?.estimate?.()
      const persisted = (await navigator.storage?.persisted?.()) ?? null
      setStorage({ usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted })
    })().catch(() => {})
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2 id="settings-title">
            <Sparkle size={18} color="var(--pink-2)" /> Ayarlar
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            <X size={20} />
          </button>
        </header>

        <section className="sheet-section">
          <h3>Yedek</h3>
          <p className="muted">
            Notların sadece bu cihazda duruyor. Yedek dosyasını iCloud Drive'a ya da Dosyalar'a kaydedersen cihaz değişse bile notların kaybolmaz.
          </p>
          <p className="sheet-meta">{lastBackup ? `Son yedek: ${relativeDate(lastBackup)}` : 'Henüz yedek alınmadı.'}</p>
          <div className="sheet-row">
            <button className="btn primary" onClick={() => exportBackup()}>
              <Download size={18} /> Yedeği indir
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Upload size={18} /> Yedekten geri yükle
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) importBackupFile(f)
              }}
            />
          </div>
          <p className="muted small">Geri yüklemede aynı not iki yerde de varsa daha yeni olan korunur.</p>
        </section>

        <section className="sheet-section">
          <h3>Yazı</h3>
          <label className="sheet-field">
            <span>Yazı boyutu</span>
            <input
              type="range"
              min={14}
              max={30}
              step={1}
              value={s.textSize}
              onChange={(e) => setSettings({ textSize: Number(e.target.value) })}
            />
            <span className="sheet-value">{s.textSize}px</span>
          </label>
        </section>

        <section className="sheet-section">
          <h3>Çizim</h3>
          <label className="sheet-switch">
            <input type="checkbox" checked={s.fingerDraw} onChange={(e) => setSettings({ fingerDraw: e.target.checked })} />
            <span className="switch" aria-hidden="true" />
            <span>
              Parmakla çiz
              <small>Kapalıyken parmak sayfayı kaydırır, sadece kalem çizer.</small>
            </span>
          </label>
        </section>

        <section className="sheet-section">
          <h3>Depolama</h3>
          {storage ? (
            <ul className="sheet-list">
              <li>{formatBytes(storage.usage)} kullanılıyor</li>
              <li>
                {storage.persisted
                  ? 'Kalıcı depolama açık: tarayıcı notları kendiliğinden silmez.'
                  : isStandalone()
                    ? 'Kalıcı depolama izni verilmedi. Düzenli yedek almayı unutma.'
                    : "Kalıcı depolama için uygulamayı ana ekrana ekle (Safari'de Paylaş → Ana Ekrana Ekle)."}
              </li>
            </ul>
          ) : (
            <p className="muted">Hesaplanıyor…</p>
          )}
        </section>

        <footer className="sheet-foot muted small">notlarım · sürüm {__APP_VERSION__}</footer>
      </motion.div>
    </motion.div>
  )
}
