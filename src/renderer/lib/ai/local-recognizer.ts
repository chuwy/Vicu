import type { VoiceRecognizer, RecognizerHandlers } from '../voice/recognizer'
import type { VoiceErrorCode } from '../../../shared/voice-types'
import type { SpeechEventEnvelope, SpeechStartOptions, SpeechStatus } from '../../../shared/ai/types'
import { startMicCapture, type MicCapture } from './mic-capture'

/**
 * Voice input through the assistant's local speech (docs/ai-assistant-v1.md section 3): the
 * microphone is recorded here and streamed to the main process, which cuts phrases with the voice
 * detector and transcribes each one as it ends. Speaks the same recognizer interface as the
 * platform recognisers (lib/voice/recognizer.ts), so holding +, the voice shortcut, the palette and
 * Talk use it unchanged; the partial words are the phrases finished so far.
 */
export interface LocalSpeechBridge {
  status(): Promise<SpeechStatus>
  start(options: SpeechStartOptions): Promise<{ success: true; sessionId: number } | { success: false; error: string; code: string }>
  audio(sessionId: number, samples: Float32Array): Promise<boolean>
  stop(sessionId: number): Promise<boolean>
  cancel(sessionId: number): Promise<boolean>
  onEvent(cb: (envelope: SpeechEventEnvelope) => void): () => void
}

export interface LocalRecognizerOptions {
  /** The language setting and the vocabulary hint, read when a recording starts. */
  startOptions: () => SpeechStartOptions
  /** The microphone (a fake in tests). */
  capture?: (onChunk: (samples: Float32Array) => void) => Promise<MicCapture>
}

export function createLocalRecognizer(bridge: LocalSpeechBridge, options: LocalRecognizerOptions): VoiceRecognizer {
  const capture = options.capture ?? startMicCapture
  let handlers: RecognizerHandlers | null = null
  let sessionId: number | null = null
  let mic: MicCapture | null = null
  let stopRequested = false
  let unsubscribe: (() => void) | null = null

  const finish = () => {
    handlers = null
    sessionId = null
    stopRequested = false
    const current = mic
    mic = null
    if (current) void current.stop()
  }

  const ensureSubscribed = () => {
    unsubscribe ??= bridge.onEvent(({ sessionId: id, event }) => {
      const h = handlers
      if (!h || id !== sessionId) return
      switch (event.type) {
        case 'ready': h.onReady(); break
        case 'partial': h.onPartial(event.text); break
        case 'final': finish(); h.onFinal(event.text); break
        case 'error': finish(); h.onError('failed', event.message); break
      }
    })
  }

  const stopNow = async () => {
    const id = sessionId
    const current = mic
    mic = null
    // The last block of audio reaches main before the stop does.
    if (current) await current.stop()
    if (id !== null) void bridge.stop(id)
  }

  return {
    availability: async () => {
      const status = await bridge.status()
      return status.engine && status.activeModelId
        ? { available: true, engine: 'local-speech', onDevice: true }
        : { available: false, engine: 'local-speech', onDevice: true, reason: 'No speech model is downloaded.' }
    },
    start: async (next) => {
      ensureSubscribed()
      if (handlers) {
        const id = sessionId
        finish()
        if (id !== null) void bridge.cancel(id)
      }
      handlers = next
      const result = await bridge.start(options.startOptions())
      if (handlers !== next) {
        if (result.success) void bridge.cancel(result.sessionId)
        return false
      }
      if (!result.success) {
        finish()
        const code: VoiceErrorCode = result.code === 'mic-denied' ? 'mic-denied' : result.code === 'busy' ? 'busy' : 'unavailable'
        next.onError(code, result.error)
        return false
      }
      sessionId = result.sessionId
      const id = result.sessionId
      try {
        const recorder = await capture((samples) => {
          if (sessionId === id) void bridge.audio(id, samples)
        })
        if (sessionId !== id) {
          void recorder.stop()
          return false
        }
        mic = recorder
      } catch (err) {
        finish()
        void bridge.cancel(id)
        next.onError('audio', err instanceof Error && err.name === 'NotAllowedError'
          ? 'Vicu may not use the microphone.'
          : 'The microphone could not be opened.')
        return false
      }
      if (stopRequested) await stopNow()
      return true
    },
    stop: () => {
      if (!handlers) return
      if (sessionId === null || !mic) {
        stopRequested = true
        return
      }
      void stopNow()
    },
    cancel: () => {
      if (!handlers) return
      const id = sessionId
      finish()
      if (id !== null) void bridge.cancel(id)
    },
  }
}
