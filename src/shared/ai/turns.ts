/**
 * The open microphone of docs/ai-assistant-v1.md section 3.7, as pure rules: where a turn ends,
 * when talking again cancels the request sent for the previous turn, and when the microphone
 * pauses and turns itself off. Smart dictation once locked (section 4) and Talk (section 6) use it.
 *
 * No timers and no clock: every input carries its time `at` (milliseconds, any origin, never going
 * backwards) and the caller runs the effects it returns, as completion-hold.ts does. The voice
 * detector's turns (`VadTurnTracker`) count audio instead: they run in the main process on the
 * detector's windows.
 */
import { SPEECH } from './contract'

// --- Turns from the voice detector (local speech) -------------------------------------------

export interface VadTurnSettings {
  threshold: number
  minSpeechMs: number
  minSilenceMs: number
  endOfTurnMs: number
}

export function vadTurnSettings(): VadTurnSettings {
  return {
    threshold: SPEECH.vad.threshold,
    minSpeechMs: SPEECH.vad.min_speech_ms,
    minSilenceMs: SPEECH.vad.min_silence_ms,
    endOfTurnMs: SPEECH.turn.end_of_turn_ms,
  }
}

/** `speech`: the turn has `minSpeechMs` of speech (the person talks). `end`: the pause after it ended the turn. */
export type VadTurnSignal = 'speech' | 'end'

/**
 * Turns from the speech probability per detector window: `speech` once a turn has `minSpeechMs` of
 * speech, `end` after a pause of `endOfTurnMs` that follows it. Speech that never reaches
 * `minSpeechMs` (a cough, a click) is forgotten after `minSilenceMs`, as the phrase cutter drops it
 * (3.2), and ends no turn.
 */
export class VadTurnTracker {
  private speechMs = 0
  private silenceMs = 0
  private spoke = false

  constructor(private readonly settings: VadTurnSettings, private readonly windowMs: number) {}

  /** The current turn has speech. */
  get speaking(): boolean {
    return this.spoke
  }

  push(probabilities: readonly number[]): VadTurnSignal[] {
    const signals: VadTurnSignal[] = []
    for (const probability of probabilities) {
      if (probability >= this.settings.threshold) {
        this.silenceMs = 0
        this.speechMs += this.windowMs
        if (!this.spoke && this.speechMs >= this.settings.minSpeechMs) {
          this.spoke = true
          signals.push('speech')
        }
        continue
      }
      this.silenceMs += this.windowMs
      if (this.spoke && this.silenceMs >= this.settings.endOfTurnMs) {
        signals.push('end')
        this.reset()
      } else if (!this.spoke && this.silenceMs >= this.settings.minSilenceMs) {
        this.speechMs = 0
      }
    }
    return signals
  }

  /** Ends the turn now (an open microphone's turn reached `audio.max_seconds`, 3.1). */
  forceEnd(): VadTurnSignal[] {
    if (!this.spoke) return []
    this.reset()
    return ['end']
  }

  private reset(): void {
    this.spoke = false
    this.speechMs = 0
    this.silenceMs = 0
  }
}

// --- Words ------------------------------------------------------------------------------------

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/** Two pieces of what was said, in order, with one space between them. */
export function joinWords(first: string, second: string): string {
  return [first.trim(), second.trim()].filter(Boolean).join(' ')
}

/**
 * The words a platform recogniser added after `consumed`, its text when the last turn ended. It
 * sends its whole text every time and may still correct earlier words, so when the text no longer
 * starts with `consumed` the new words are found by count: as many leading words as `consumed` had
 * are skipped. A text with fewer words than that means the recogniser started over: all of it is new.
 */
export function wordsAfter(consumed: string, text: string): string {
  const before = wordsOf(consumed)
  const now = wordsOf(text)
  if (before.length === 0) return now.join(' ')
  if (now.slice(0, before.length).join(' ').toLowerCase() === before.join(' ').toLowerCase()) return now.slice(before.length).join(' ')
  if (now.length < before.length) return now.join(' ')
  return now.slice(before.length).join(' ')
}

// --- Turn-taking ------------------------------------------------------------------------------

export interface OpenMicSettings {
  endOfTurnMs: number
  idleMs: number
}

/** The fixture's settings; a brain dump (4.8) turns off after `dump_idle_s` instead of `idle_s`. */
export function openMicSettings(dump = false): OpenMicSettings {
  return { endOfTurnMs: SPEECH.turn.end_of_turn_ms, idleMs: (dump ? SPEECH.turn.dump_idle_s : SPEECH.turn.idle_s) * 1000 }
}

/**
 * `listening`: the recogniser runs. `paused`: it is stopped while the device reads an answer.
 * `stopping`: turned off, the recogniser's last words are still coming.
 */
export type OpenMicPhase = 'off' | 'listening' | 'paused' | 'stopping'

export type OpenMicEffect =
  /** Send a turn's words (with the words of an interrupted request first); `done(id)` when it finished. */
  | { type: 'send'; id: number; text: string }
  /** The person talks again: cancel the request still running for the previous turn. */
  | { type: 'cancel'; id: number }
  /** Stop the recogniser while the device speaks; its words so far are dropped. */
  | { type: 'pause' }
  /** Start the recogniser again: after the voice, or after it ended its utterance by itself. */
  | { type: 'listen' }
  /** Stop the recogniser; its last words come back as `final`. */
  | { type: 'finish' }
  /** The microphone is off: idle for `idleMs`, turned off, or failed. */
  | { type: 'off' }

export interface OpenMicStart {
  /** Turns come from the voice detector (local speech) instead of the recogniser's words; unknown until it is ready. */
  vad?: boolean
  /** Words heard before (smart dictation locked during a quick capture): they go out with the first turn. */
  carried?: string
  /** The words of the turn being heard at that moment (vad: of this turn; else the recogniser's whole text). */
  heard?: string
  /** vad: the turn being heard has speech. */
  speaking?: boolean
}

/**
 * The turn-taking of an open microphone. Inputs:
 *
 * - `heard`: the recogniser's words (local speech: the current turn's; a platform recogniser: its
 *   whole text, from which the turn's words are cut with `wordsAfter`).
 * - `speech` and `turn` (local speech): the voice detector heard speech start, or a turn end with
 *   its words. A platform recogniser's turn starts with its first words and ends when they have not
 *   changed for `endOfTurnMs` (checked on `tick`), or when it ends its utterance (`final`).
 * - `done`: the request sent for a turn finished (an answer, a failure, or the words answered a card).
 * - `setInterruptible(false)` while the running request must not be cancelled: a card waits for
 *   the person (talking is the answer to it, 6.1), or a change in it was already applied.
 *
 * Speech starting while the request for the previous turn runs cancels it, and its words go out
 * together with the new turn's. A turn that gave no words sends nothing unless it carries words.
 * The microphone turns off after `idleMs` without speech (counted from the last speech, answer or
 * end of the voice; not while a request runs).
 */
export class OpenMic {
  private settings: OpenMicSettings
  private phaseNow: OpenMicPhase = 'off'
  private vad = false
  private carried = ''
  private inFlight: { id: number; text: string } | null = null
  private interruptible = true
  /** Words mode: the recogniser's whole text, and that text when the last turn ended. */
  private whole = ''
  private consumed = ''
  private turnWords = ''
  private wordsAt = 0
  private spoke = false
  private quietSince = 0
  private nextId = 1

  constructor(settings: OpenMicSettings = openMicSettings()) {
    this.settings = settings
  }

  get phase(): OpenMicPhase {
    return this.phaseNow
  }

  /** What to show while listening: carried words, then the turn being heard. */
  get words(): string {
    return joinWords(this.carried, this.turnWords)
  }

  /** The person is in the middle of a turn. */
  get hearing(): boolean {
    return this.spoke
  }

  /** A request for a turn has not finished. */
  get requestRunning(): boolean {
    return this.inFlight !== null
  }

  start(at: number, options: OpenMicStart = {}): OpenMicEffect[] {
    this.phaseNow = 'listening'
    this.vad = options.vad ?? false
    this.carried = (options.carried ?? '').trim()
    this.inFlight = null
    this.interruptible = true
    this.whole = ''
    this.consumed = ''
    this.turnWords = ''
    this.spoke = false
    this.quietSince = at
    const heard = (options.heard ?? '').trim()
    if (heard) {
      this.whole = heard
      this.turnWords = heard
      this.wordsAt = at
      this.spoke = true
    } else if (this.vad && options.speaking) {
      this.spoke = true
    }
    // Locked after a pause: what was heard goes out now instead of waiting for more speech.
    if (this.carried && !this.spoke) return this.endTurn(at, '')
    return []
  }

  /** A recogniser session started (again): how its turns end; a new session's text starts empty. */
  session(vad: boolean): void {
    this.vad = vad
    this.whole = ''
    this.consumed = ''
  }

  heard(at: number, text: string): OpenMicEffect[] {
    if (this.phaseNow !== 'listening' && this.phaseNow !== 'stopping') return []
    let words: string
    if (this.vad) {
      words = text.trim()
    } else {
      this.whole = text
      words = wordsAfter(this.consumed, text)
    }
    if (words !== this.turnWords) {
      this.turnWords = words
      this.wordsAt = at
      this.quietSince = at
    }
    // A platform recogniser's first words start the turn; local speech says so itself (`speech`).
    if (words && !this.spoke && !this.vad && this.phaseNow === 'listening') return this.speechStarted(at)
    return []
  }

  speech(at: number): OpenMicEffect[] {
    if (this.phaseNow !== 'listening' || this.spoke) return []
    return this.speechStarted(at)
  }

  turn(at: number, text: string): OpenMicEffect[] {
    if (this.phaseNow !== 'listening' && this.phaseNow !== 'stopping') return []
    return this.endTurn(at, text)
  }

  /** The recogniser ended (stopped, or ended its utterance): its last words (vad: of this turn; else its whole text). */
  final(at: number, text: string): OpenMicEffect[] {
    if (this.phaseNow !== 'listening' && this.phaseNow !== 'stopping') return []
    const effects = this.endTurn(at, this.vad ? text : wordsAfter(this.consumed, text))
    this.whole = ''
    this.consumed = ''
    if (this.phaseNow === 'stopping') {
      this.phaseNow = 'off'
      effects.push({ type: 'off' })
    } else {
      effects.push({ type: 'listen' })
    }
    return effects
  }

  done(at: number, id: number): void {
    if (this.inFlight?.id !== id) return
    this.inFlight = null
    this.quietSince = Math.max(this.quietSince, at)
  }

  setInterruptible(value: boolean): void {
    this.interruptible = value
  }

  /** How long it listens without speech before it turns off (a brain dump switched on or off, 4.8). */
  setIdleMs(idleMs: number): void {
    this.settings = { ...this.settings, idleMs }
  }

  /** The device reads an answer aloud (true) or has finished (false). */
  voice(at: number, speaking: boolean): OpenMicEffect[] {
    if (speaking && this.phaseNow === 'listening') {
      this.phaseNow = 'paused'
      this.spoke = false
      this.turnWords = ''
      return [{ type: 'pause' }]
    }
    if (!speaking && this.phaseNow === 'paused') {
      this.phaseNow = 'listening'
      this.quietSince = at
      return [{ type: 'listen' }]
    }
    return []
  }

  tick(at: number): OpenMicEffect[] {
    if (this.phaseNow !== 'listening') return []
    if (!this.vad && this.spoke && this.turnWords && at - this.wordsAt >= this.settings.endOfTurnMs) return this.endTurn(at, this.turnWords)
    const waiting = this.inFlight !== null && this.interruptible
    if (!this.spoke && !waiting && at - this.quietSince >= this.settings.idleMs) {
      this.phaseNow = 'off'
      return [{ type: 'off' }]
    }
    return []
  }

  /** Turned off: the words of the turn being heard still go out (`finish`, then `final`). */
  stop(at: number): OpenMicEffect[] {
    if (this.phaseNow === 'listening') {
      this.phaseNow = 'stopping'
      return [{ type: 'finish' }]
    }
    if (this.phaseNow === 'paused') {
      const effects = this.endTurn(at, '')
      this.phaseNow = 'off'
      effects.push({ type: 'off' })
      return effects
    }
    return []
  }

  /** Turned off at once: the words being heard are dropped. */
  cancel(): OpenMicEffect[] {
    if (this.phaseNow === 'off') return []
    this.phaseNow = 'off'
    this.spoke = false
    this.turnWords = ''
    this.carried = ''
    return [{ type: 'off' }]
  }

  private speechStarted(at: number): OpenMicEffect[] {
    this.spoke = true
    this.quietSince = at
    return this.interrupt()
  }

  private interrupt(): OpenMicEffect[] {
    const running = this.inFlight
    if (!running || !this.interruptible) return []
    this.inFlight = null
    this.carried = joinWords(running.text, this.carried)
    return [{ type: 'cancel', id: running.id }]
  }

  private endTurn(at: number, text: string): OpenMicEffect[] {
    this.spoke = false
    this.turnWords = ''
    this.quietSince = at
    if (!this.vad) this.consumed = this.whole
    if (!text.trim() && !this.carried) return []
    // Talked over a running request without a `speech` first (it came while the turn was still
    // being transcribed): the new turn still replaces it.
    const effects = this.interrupt()
    const words = joinWords(this.carried, text)
    this.carried = ''
    const id = this.nextId++
    this.inFlight = { id, text: words }
    effects.push({ type: 'send', id, text: words })
    return effects
  }
}
