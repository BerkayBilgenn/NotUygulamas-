import { db } from '../db/db'

/** Converts work interrupted by a closed tab into a safe, retryable state. */
export async function recoverInterruptedTranscripts(): Promise<number> {
  const rows = (await db.recordings.toArray()).filter((recording) => recording.transcript?.status === 'processing')
  if (rows.length === 0) return 0

  await db.transaction('rw', db.recordings, async () => {
    for (const recording of rows) {
      await db.recordings.update(recording.id, {
        transcript: { status: 'error', error: 'interrupted', updatedAt: Date.now() },
      })
    }
  })

  return rows.length
}
