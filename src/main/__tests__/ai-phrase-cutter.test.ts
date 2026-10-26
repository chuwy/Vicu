import { describe, expect, it } from 'vitest'
import { cutterSettings, joinPhraseTexts, PhraseCutter } from '../ai/speech/phrase-cutter'
import { SPEECH } from '../../shared/ai/contract'

// docs/ai-assistant-v1.md section 3.2 with the fixture's starting values: windows of 512 samples
// (32 ms), threshold 0.5, speech of at least 250 ms, a pause of 600 ms ends a phrase, 200 ms of pad.
const W = 512
const settings = cutterSettings(SPEECH.vad)

/** Feeds windows whose samples carry their window number, so a phrase shows which windows it holds. */
function run(probabilities: number[], chunk = 3) {
  const cutter = new PhraseCutter(settings)
  const phrases: Float32Array[] = []
  for (let i = 0; i < probabilities.length; i += chunk) {
    const part = probabilities.slice(i, i + chunk)
    const samples = new Float32Array(part.length * W)
    part.forEach((_, j) => samples.fill(i + j, j * W, (j + 1) * W))
    phrases.push(...cutter.push(samples, part))
  }
  phrases.push(...cutter.finish())
  return phrases.map((p) => ({ first: p[0], last: p[p.length - 1], windows: p.length / W }))
}

const speech = (n: number) => Array(n).fill(0.9)
const silence = (n: number) => Array(n).fill(0.05)

describe('phrase cutter', () => {
  it('cuts phrases at a 600 ms pause, with 200 ms of pad on each side, and drops the silence', () => {
    // 10 windows of silence, 20 of speech, 25 of silence (800 ms), 15 of speech, silence.
    const phrases = run([...silence(10), ...speech(20), ...silence(25), ...speech(15), ...silence(30)])
    expect(phrases).toHaveLength(2)
    // pad 200 ms = 3200 samples = 6.25 windows: the phrase starts inside window 3.
    expect(phrases[0].first).toBe(3)
    expect(phrases[0].last).toBe(36)
    expect(phrases[1].first).toBe(48)
  })

  it('keeps one phrase over a pause shorter than 600 ms', () => {
    expect(run([...silence(5), ...speech(10), ...silence(15), ...speech(10), ...silence(30)])).toHaveLength(1)
  })

  it('drops a blip shorter than 250 ms of speech', () => {
    expect(run([...silence(5), ...speech(5), ...silence(40)])).toHaveLength(0)
  })

  it('cuts a phrase that reaches 28 s and goes on with the next', () => {
    const windowsIn28s = Math.ceil((28 * 16000) / W)
    const phrases = run([...speech(windowsIn28s + 50), ...silence(30)], 10)
    expect(phrases).toHaveLength(2)
    expect(phrases[0].windows).toBeLessThanOrEqual(windowsIn28s)
  })

  it('closes the open phrase when the recording ends', () => {
    const phrases = run([...silence(3), ...speech(12)])
    expect(phrases).toHaveLength(1)
    expect(phrases[0].last).toBe(14)
  })

  it('joins trimmed texts with one space and drops phrases with no letters or digits', () => {
    expect(joinPhraseTexts([' Buy milk.', '...', ' and call Ana ', '', '♪'])).toBe('Buy milk. and call Ana')
  })
})
