import { motion } from 'motion/react'
import { MousePointerClick, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import { closePlayer, cycleRate, seekMs, setSync, skip, togglePlay, usePlayback } from '../lib/playback'
import { formatDuration } from '../lib/recorder'

export function RecordingPlayer({ noteId }: { noteId: string }) {
  const p = usePlayback()
  if (!p.rec || p.rec.noteId !== noteId) return null
  const dur = p.rec.duration
  return (
    <motion.div
      className="player"
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      role="region"
      aria-label="Ders kaydı"
    >
      <button className="icon-btn small" onClick={() => skip(-15000)} aria-label="15 saniye geri">
        <RotateCcw size={17} />
      </button>
      <button className="player-play" onClick={togglePlay} aria-label={p.playing ? 'Duraklat' : 'Oynat'}>
        {p.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <button className="icon-btn small" onClick={() => skip(15000)} aria-label="15 saniye ileri">
        <RotateCw size={17} />
      </button>
      <input
        className="player-range"
        type="range"
        min={0}
        max={Math.max(1, dur)}
        step={250}
        value={Math.min(p.currentMs, dur)}
        onChange={(e) => seekMs(Number(e.target.value))}
        aria-label="Kayıttaki konum"
      />
      <span className="player-time">
        {formatDuration(p.currentMs)} / {formatDuration(dur)}
      </span>
      <button className="player-rate" onClick={cycleRate} aria-label="Oynatma hızı">
        {p.rate}×
      </button>
      <button
        className={`player-sync ${p.sync ? 'on' : ''}`}
        onClick={() => setSync(!p.sync)}
        aria-pressed={p.sync}
        title={p.sync ? 'Nota dokununca o ana gider (yazma kapalı)' : 'Nota dokunmak normal yazar'}
      >
        <MousePointerClick size={16} /> Nota dokun
      </button>
      <button className="icon-btn small" onClick={closePlayer} aria-label="Oynatıcıyı kapat">
        <X size={17} />
      </button>
    </motion.div>
  )
}
