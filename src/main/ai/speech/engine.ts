/**
 * Local speech in the main process (docs/ai-assistant-v1.md section 3): the engine keeps the
 * Silero detector and one speech model open, and a session turns a recording into text while the
 * user talks: the detector's probabilities cut phrases (phrase-cutter.ts), each finished phrase is
 * transcribed at once, in order, on koffi's worker threads, and the texts are joined. The same
 * probabilities mark the turns of an open microphone (3.7, `VadTurnTracker`).
 *
 * Audio lives in memory only and is dropped once its phrase is transcribed (3.1). A recording ends
 * at stop, on cancel, or after `audio_max_seconds` (per turn with an open microphone).
 */
import { SPEECH } from '../../../shared/ai/contract'
import { VadTurnTracker, vadTurnSettings } from '../../../shared/ai/turns'
import type { SpeechEvent } from '../../../shared/ai/types'
import type { NativeHandle, SpeechNative } from './native'
import { cutterSettings, joinPhraseTexts, PhraseCutter } from './phrase-cutter'

const SAMPLE_RATE = SPEECH.audio.sample_rate_hz

export class SpeechEngine {
  private vad: NativeHandle | null = null
  private model: { path: string; engine: number; handle: Promise<NativeHandle | null> } | null = null
  /** Every call on the model handle, one at a time. */
  private chain: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(private readonly native: SpeechNative, private readonly vadPath: string, private readonly useGpu = true) {}

  get version(): string {
    return this.native.version()
  }

  /** The detector, opened once and reset per recording. */
  openVad(): NativeHandle {
    if (this.closed) throw new Error('Speech has shut down.')
    if (!this.vad) {
      this.vad = this.native.vadOpen(this.vadPath, 2)
      if (!this.vad) throw new Error('The voice detector could not be loaded.')
    }
    this.native.vadReset(this.vad)
    return this.vad
  }

  vadFeed(samples: Float32Array): number[] {
    if (!this.vad) throw new Error('The voice detector is not open.')
    return this.native.vadFeed(this.vad, samples)
  }

  /** Loads a model (once; another path closes the previous one). */
  loadModel(path: string, engine: number): Promise<NativeHandle | null> {
    if (this.closed) return Promise.resolve(null)
    if (this.model && this.model.path === path && this.model.engine === engine) return this.model.handle
    const previous = this.model
    const handle = this.enqueue(async () => {
      if (previous) {
        const old = await previous.handle
        if (old) this.native.modelClose(old)
      }
      return this.native.modelOpen(path, engine, this.useGpu)
    })
    this.model = { path, engine, handle }
    // A failed load is tried again next time.
    void handle.then((h) => {
      if (!h && this.model?.handle === handle) this.model = null
    })
    return handle
  }

  transcribe(samples: Float32Array, language: string | null, prompt: string | null): Promise<string | null> {
    const current = this.model
    if (!current) return Promise.resolve(null)
    return this.enqueue(async () => {
      const handle = await current.handle
      if (!handle || this.closed) return null
      return this.native.transcribe(handle, samples, language, prompt, SPEECH.decode.max_threads)
    })
  }

  /** Asks a running transcription to stop early. */
  abort(): void {
    const current = this.model
    if (!current) return
    void current.handle.then((handle) => {
      if (handle) this.native.abort(handle)
    })
  }

  /** Closes every handle (before quit: ggml's Metal teardown asserts on an open one). */
  async closeAll(): Promise<void> {
    this.closed = true
    this.abort()
    await this.chain.catch(() => {})
    const current = this.model
    this.model = null
    if (current) {
      const handle = await current.handle.catch(() => null)
      if (handle) this.native.modelClose(handle)
    }
    if (this.vad) {
      this.native.vadClose(this.vad)
      this.vad = null
    }
  }

  /** Forgets the loaded model (deleted from Settings). */
  async unloadModel(path: string): Promise<void> {
    const current = this.model
    if (!current || current.path !== path) return
    this.model = null
    await this.enqueue(async () => {
      const handle = await current.handle
      if (handle) this.native.modelClose(handle)
      return null
    })
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => {})
    return next
  }
}

export interface SessionOptions {
  modelPath: string
  engine: number
  /** `auto` or an ISO 639-1 code. */
  language: string
  /** The vocabulary hint; Parakeet ignores it. */
  hint: string | null
  /** An open microphone (3.7): `audio_max_seconds` count per turn. */
  openMic?: boolean
}

/** The detector reads windows of 512 samples (32 ms at 16 kHz). */
const VAD_WINDOW = 512

/**
 * One recording. Events go to the window that started it. Besides the text it reports its turns:
 * `speech` when a turn has enough speech, `turn` with the turn's words at the pause that ends it.
 * Both go through the same chain as the phrases, so a turn is reported once its phrases are
 * transcribed and the next turn's `speech` never arrives before it.
 */
export class SpeechSession {
  private readonly cutter = new PhraseCutter(cutterSettings(SPEECH.vad), SAMPLE_RATE, VAD_WINDOW)
  private readonly turns = new VadTurnTracker(vadTurnSettings(), (VAD_WINDOW * 1000) / SAMPLE_RATE)
  private readonly texts: string[] = []
  /** Index in `texts` where the current turn starts. */
  private turnFrom = 0
  private turnStartSample = 0
  private pending: Promise<void> = Promise.resolve()
  private state: 'starting' | 'recording' | 'finishing' | 'done' = 'starting'
  private readonly maxSamples = SPEECH.audio.max_seconds * SAMPLE_RATE

  constructor(
    private readonly engine: SpeechEngine,
    private readonly options: SessionOptions,
    private readonly emit: (event: SpeechEvent) => void,
  ) {}

  get finished(): boolean {
    return this.state === 'done'
  }

  /** Opens the detector at once and loads the model in the background (phrases wait for it). */
  start(): void {
    this.engine.openVad()
    void this.engine.loadModel(this.options.modelPath, this.options.engine).then((handle) => {
      if (!handle && this.state !== 'done') this.fail('The speech model could not be loaded.')
    })
    this.state = 'recording'
    this.emit({ type: 'ready' })
  }

  addAudio(samples: Float32Array): void {
    if (this.state !== 'recording' || samples.length === 0) return
    const room = this.options.openMic ? samples.length : this.maxSamples - this.cutter.totalSamples
    const part = room < samples.length ? samples.subarray(0, Math.max(0, room)) : samples
    let probabilities: number[]
    try {
      probabilities = this.engine.vadFeed(part)
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'The voice detector failed.')
      return
    }
    for (const phrase of this.cutter.push(part, probabilities)) this.transcribe(phrase)
    for (const signal of this.turns.push(probabilities)) {
      if (signal === 'speech') this.queue(() => this.emit({ type: 'speech' }))
      else this.endTurn()
    }
    if (this.options.openMic) {
      // An open microphone's turn ends after audio_max_seconds (3.1, 3.7).
      if (this.cutter.totalSamples - this.turnStartSample >= this.maxSamples) {
        if (this.turns.forceEnd().length > 0) this.endTurn()
        else this.turnStartSample = this.cutter.totalSamples
      }
    } else if (this.cutter.totalSamples >= this.maxSamples) {
      // The recording ends after audio_max_seconds (3.1).
      void this.stop()
    }
  }

  /** Ends the recording: the last phrase is transcribed, then `final` carries the whole text. */
  async stop(): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'starting') return
    this.state = 'finishing'
    for (const phrase of this.cutter.finish()) this.transcribe(phrase)
    await this.pending
    // Cancelled or failed while the last phrases were transcribed.
    if ((this.state as string) !== 'finishing') return
    this.state = 'done'
    this.emit({ type: 'final', text: joinPhraseTexts(this.texts), turn: this.turnText() })
  }

  cancel(): void {
    if (this.state === 'done') return
    this.state = 'done'
    this.engine.abort()
  }

  private transcribe(phrase: Float32Array): void {
    const language = this.options.language === 'auto' ? null : this.options.language
    this.queue(async () => {
      let text: string | null = null
      try {
        text = await this.engine.transcribe(phrase, language, this.options.hint)
      } catch {
        text = null
      }
      if (this.isDone()) return
      if (text !== null) this.texts.push(text)
      this.emit({ type: 'partial', text: joinPhraseTexts(this.texts), turn: this.turnText() })
    })
  }

  /** A pause ended the turn: its phrases (a phrase still open included) are transcribed, then `turn`. */
  private endTurn(): void {
    for (const phrase of this.cutter.finish()) this.transcribe(phrase)
    this.turnStartSample = this.cutter.totalSamples
    this.queue(() => {
      const text = this.turnText()
      this.turnFrom = this.texts.length
      this.emit({ type: 'turn', text })
    })
  }

  private turnText(): string {
    return joinPhraseTexts(this.texts.slice(this.turnFrom))
  }

  /** Runs after everything queued before it; nothing runs once the session is done. */
  private queue(step: () => void | Promise<void>): void {
    this.pending = this.pending.then(async () => {
      if (this.isDone()) return
      await step()
    })
  }

  /** Read through a method: the state changes while a transcription is awaited. */
  private isDone(): boolean {
    return this.state === 'done'
  }

  private fail(message: string): void {
    if (this.state === 'done') return
    this.state = 'done'
    this.emit({ type: 'error', message })
  }
}
