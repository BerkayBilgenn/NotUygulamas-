import { describe, expect, it } from 'vitest'
import { downmixAndResample, mergeTranscriptParts, splitAudio } from './audio'

describe('transkripsiyon ses yardımcıları', () => {
  it('stereoyu mono 16 kHz örneklere dönüştürür', () => {
    const out = downmixAndResample(
      [new Float32Array([1, 0, -1, 0]), new Float32Array([0, 1, 0, -1])],
      32_000,
    )

    expect(out.length).toBe(2)
    expect(Array.from(out)).toEqual([0.5, -0.5])
  })

  it('45 dakikayı sabit boyutlu ve sıralı parçalara böler', () => {
    const out = splitAudio(new Float32Array(10 * 60 * 45), 10, 30, 1)

    expect(out.length).toBeGreaterThan(90)
    expect(out.every((segment, index) => segment.index === index && segment.samples.length <= 10 * 30)).toBe(true)
  })

  it('örtüşen kelimeleri bir kez bırakır', () => {
    expect(
      mergeTranscriptParts([
        'Hücrenin enerji merkezi mitokondridir',
        'enerji merkezi mitokondridir ve ATP üretir',
      ]),
    ).toBe('Hücrenin enerji merkezi mitokondridir ve ATP üretir')
  })
})
