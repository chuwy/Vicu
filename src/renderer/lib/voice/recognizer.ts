import type { VoiceAvailability, VoiceErrorCode, VoiceEvent, VoiceEventEnvelope } from '../../../shared/voice-types'

// The one speech recognizer the UI talks to (docs/voice-input.md). Whatever engine main runs
// (Apple's on macOS, the Windows desktop recognizer, none on Linux), the window sees: start,
// partial words, a final text, stop, cancel, availability.

export interface RecognizerHandlers {
  onReady: () => void
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError: (code: VoiceErrorCode, message: string) => void
}

export interface VoiceRecognizer {
  availability(force?: boolean): Promise<VoiceAvailability>
  /** Starts one utterance. Resolves false (after `onError`) when it could not start. */
  start(handlers: RecognizerHandlers): Promise<boolean>
  /** Finish: `onFinal` follows. Safe before `start` has resolved. */
  stop(): void
  /** Throw the utterance away; no handler runs after this. */
  cancel(): void
}

/** The part of `window.api.voice` the recognizer uses (a fake in tests). */
export interface VoiceBridge {
  availability(force?: boolean): Promise<VoiceAvailability>
  start(options?: { locale?: string }): Promise<{ success: true; sessionId: number } | { success: false; code: VoiceErrorCode; error: string }>
  stop(sessionId?: number): Promise<boolean>
  cancel(sessionId?: number): Promise<boolean>
  onEvent(cb: (envelope: VoiceEventEnvelope) => void): () => void
}

export function createRecognizer(bridge: VoiceBridge, locale?: () => string | undefined): VoiceRecognizer {
  let handlers: RecognizerHandlers | null = null
  let sessionId: number | null = null
  let starting = false
  // Events of a session that arrive before its id is known (the start has not answered yet).
  let early: VoiceEventEnvelope[] = []
  let unsubscribe: (() => void) | null = null

  const finishSession = () => {
    handlers = null
    sessionId = null
    starting = false
    early = []
  }

  const deliver = (event: VoiceEvent) => {
    const h = handlers
    if (!h) return
    switch (event.type) {
      case 'ready': h.onReady(); break
      case 'partial': h.onPartial(event.text); break
      case 'final': finishSession(); h.onFinal(event.text); break
      case 'error': finishSession(); h.onError(event.code, event.message); break
    }
  }

  const ensureSubscribed = () => {
    if (unsubscribe) return
    unsubscribe = bridge.onEvent((envelope) => {
      if (!handlers) return
      if (sessionId === null) {
        if (starting) early.push(envelope)
        return
      }
      if (envelope.sessionId === sessionId) deliver(envelope.event)
    })
  }

  return {
    availability: (force) => bridge.availability(force),
    start: async (next) => {
      ensureSubscribed()
      if (handlers) {
        // One utterance at a time: a new start replaces the old one.
        void bridge.cancel(sessionId ?? undefined)
        finishSession()
      }
      handlers = next
      starting = true
      let result: Awaited<ReturnType<VoiceBridge['start']>>
      try {
        result = await bridge.start({ locale: locale?.() })
      } catch (err) {
        result = { success: false, code: 'failed', error: err instanceof Error ? err.message : 'Voice input could not start.' }
      }
      if (handlers !== next) {
        // Cancelled while starting: make sure main lets go of the helper it may have started.
        if (result.success) void bridge.cancel(result.sessionId)
        return false
      }
      if (!result.success) {
        finishSession()
        next.onError(result.code, result.error)
        return false
      }
      sessionId = result.sessionId
      starting = false
      const pending = early.filter((envelope) => envelope.sessionId === result.sessionId)
      early = []
      for (const envelope of pending) deliver(envelope.event)
      return true
    },
    stop: () => {
      if (!handlers) return
      void bridge.stop(sessionId ?? undefined)
    },
    cancel: () => {
      if (!handlers) return
      const id = sessionId
      finishSession()
      void bridge.cancel(id ?? undefined)
    },
  }
}
