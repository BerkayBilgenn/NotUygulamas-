export interface AudioSegment {
  index: number
  startSample: number
  samples: Float32Array
}

export function downmixAndResample(
  channels: Float32Array[],
  sourceRate: number,
  targetRate = 16_000,
): Float32Array {
  if (channels.length === 0 || channels[0].length === 0) return new Float32Array()
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new RangeError('Sample rates must be positive numbers.')
  }

  const sourceLength = Math.min(...channels.map((channel) => channel.length))
  const mono = new Float32Array(sourceLength)
  for (let sample = 0; sample < sourceLength; sample++) {
    let sum = 0
    for (const channel of channels) sum += channel[sample]
    mono[sample] = sum / channels.length
  }

  if (sourceRate === targetRate) return mono

  const outputLength = Math.max(1, Math.floor(sourceLength * targetRate / sourceRate))
  const output = new Float32Array(outputLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < outputLength; index++) {
    const position = index * ratio
    const left = Math.min(sourceLength - 1, Math.floor(position))
    const right = Math.min(sourceLength - 1, left + 1)
    const fraction = position - left
    output[index] = mono[left] + (mono[right] - mono[left]) * fraction
  }
  return output
}

export function splitAudio(
  samples: Float32Array,
  sampleRate = 16_000,
  seconds = 30,
  overlapSeconds = 1,
): AudioSegment[] {
  const segmentSize = Math.floor(sampleRate * seconds)
  const overlapSize = Math.floor(sampleRate * overlapSeconds)
  const stepSize = segmentSize - overlapSize
  if (segmentSize <= 0 || stepSize <= 0) throw new RangeError('Segment duration must be longer than overlap.')

  const segments: AudioSegment[] = []
  for (let startSample = 0; startSample < samples.length; startSample += stepSize) {
    const endSample = Math.min(samples.length, startSample + segmentSize)
    segments.push({
      index: segments.length,
      startSample,
      samples: samples.subarray(startSample, endSample),
    })
    if (endSample === samples.length) break
  }
  return segments
}

function normalizeWord(word: string): string {
  return word.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, '')
}

export function mergeTranscriptParts(parts: string[]): string {
  let merged: string[] = []
  for (const part of parts) {
    const incoming = part.trim().split(/\s+/).filter(Boolean)
    if (incoming.length === 0) continue

    const maxOverlap = Math.min(merged.length, incoming.length)
    let overlap = 0
    for (let size = maxOverlap; size >= 3; size--) {
      const suffix = merged.slice(-size).map(normalizeWord)
      const prefix = incoming.slice(0, size).map(normalizeWord)
      if (suffix.every((word, index) => word.length > 0 && word === prefix[index])) {
        overlap = size
        break
      }
    }
    merged = merged.concat(incoming.slice(overlap))
  }
  return merged.join(' ')
}
