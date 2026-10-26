/**
 * Cuts a recording into phrases while the user talks (docs/ai-assistant-v1.md section 3.2), from
 * the Silero voice detector's speech probability per window of 512 samples (32 ms at 16 kHz):
 *
 * - A phrase starts at a window whose probability reaches `threshold`, with `pad_ms` of the audio
 *   before it.
 * - It ends after a pause of at least `min_silence_ms`, keeping `pad_ms` of the pause, or when it
 *   reaches `max_phrase_s` (Whisper hears 30 s at a time); the next phrase then starts there.
 * - A phrase with less than `min_speech_ms` of speech is dropped, and so is the silence between
 *   phrases.
 *
 * Pure (no native code), so the state machine is tested with made-up probabilities.
 */
import type { VadSettings } from '../../../shared/ai/contract'

export interface CutterSettings {
  threshold: number
  minSpeechMs: number
  minSilenceMs: number
  padMs: number
  maxPhraseS: number
}

export function cutterSettings(vad: Pick<VadSettings, 'threshold' | 'min_speech_ms' | 'min_silence_ms' | 'pad_ms' | 'max_phrase_s'>): CutterSettings {
  return {
    threshold: vad.threshold,
    minSpeechMs: vad.min_speech_ms,
    minSilenceMs: vad.min_silence_ms,
    padMs: vad.pad_ms,
    maxPhraseS: vad.max_phrase_s,
  }
}

export class PhraseCutter {
  private readonly pad: number
  private readonly minSilence: number
  private readonly minSpeech: number
  private readonly maxPhrase: number

  /** Absolute index of `buffer[0]`. */
  private base = 0
  private buffer = new Float32Array(16000 * 4)
  private length = 0
  /** Windows whose probability has been read. */
  private windows = 0

  private inSpeech = false
  private phraseStart = 0
  /** End (absolute, exclusive) of the last window with speech. */
  private lastSpeechEnd = 0
  private speechSamples = 0

  constructor(private readonly settings: CutterSettings, private readonly sampleRate = 16000, private readonly window = 512) {
    const ms = (value: number) => Math.round((value * sampleRate) / 1000)
    this.pad = ms(settings.padMs)
    this.minSilence = ms(settings.minSilenceMs)
    this.minSpeech = ms(settings.minSpeechMs)
    this.maxPhrase = Math.round(settings.maxPhraseS * sampleRate)
  }

  /** All samples received so far. */
  get totalSamples(): number {
    return this.base + this.length
  }

  /**
   * Adds the samples that were fed to the detector and the probabilities it returned for them (one
   * per whole window; the detector keeps a partial window for the next call). Returns the phrases
   * that ended.
   */
  push(samples: Float32Array, probabilities: readonly number[]): Float32Array[] {
    this.append(samples)
    const phrases: Float32Array[] = []
    for (const probability of probabilities) {
      const start = this.windows * this.window
      const end = start + this.window
      this.windows++
      if (probability >= this.settings.threshold) {
        if (!this.inSpeech) {
          this.inSpeech = true
          this.phraseStart = Math.max(this.base, start - this.pad)
          this.speechSamples = 0
        }
        this.lastSpeechEnd = end
        this.speechSamples += this.window
      } else if (this.inSpeech && end - this.lastSpeechEnd >= this.minSilence) {
        const phrase = this.close(Math.min(this.lastSpeechEnd + this.pad, end))
        if (phrase) phrases.push(phrase)
      }
      if (this.inSpeech && end - this.phraseStart >= this.maxPhrase) {
        // Long speech without a pause: cut here and go on with a new phrase.
        const phrase = this.slice(this.phraseStart, end)
        phrases.push(phrase)
        this.phraseStart = end
        this.speechSamples = 0
        if (this.lastSpeechEnd < end) this.inSpeech = false
      }
    }
    if (!this.inSpeech) this.forgetBefore(this.totalSamples - this.pad - this.window)
    return phrases
  }

  /** The recording ended: the phrase still open, if it had enough speech. */
  finish(): Float32Array[] {
    if (!this.inSpeech) return []
    const phrase = this.close(Math.min(this.lastSpeechEnd + this.pad, this.totalSamples))
    return phrase ? [phrase] : []
  }

  private close(end: number): Float32Array | null {
    this.inSpeech = false
    const enough = this.speechSamples >= this.minSpeech
    const phrase = enough ? this.slice(this.phraseStart, end) : null
    this.speechSamples = 0
    this.forgetBefore(end)
    return phrase
  }

  private slice(from: number, to: number): Float32Array {
    const start = Math.max(0, from - this.base)
    const end = Math.max(start, Math.min(this.length, to - this.base))
    return this.buffer.slice(start, end)
  }

  private append(samples: Float32Array): void {
    if (this.length + samples.length > this.buffer.length) {
      const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + samples.length))
      grown.set(this.buffer.subarray(0, this.length))
      this.buffer = grown
    }
    this.buffer.set(samples, this.length)
    this.length += samples.length
  }

  /** Drops audio before an absolute index (never what an open phrase still needs). */
  private forgetBefore(index: number): void {
    const keepFrom = this.inSpeech ? Math.min(index, this.phraseStart) : index
    const drop = Math.min(this.length, Math.max(0, keepFrom - this.base))
    if (drop <= 0) return
    this.buffer.copyWithin(0, drop, this.length)
    this.length -= drop
    this.base += drop
  }
}

/** Phrases' texts, each trimmed, joined with one space; a phrase with no letters or digits is dropped (3.2). */
export function joinPhraseTexts(texts: readonly string[]): string {
  return texts.map((text) => text.trim()).filter((text) => /[\p{L}\p{N}]/u.test(text)).join(' ')
}
