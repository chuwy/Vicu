// What the main window and the main process exchange about voice input (docs/voice-input.md).
// The engine behind it differs per platform; these shapes do not.

/**
 * Which recognizer runs: Apple's speech recognizer, the Windows desktop recognizer, the assistant's
 * local speech (a downloaded Whisper or Parakeet model, docs/ai-assistant-v1.md section 3), or none.
 */
export type VoiceEngineName = 'macos-speech' | 'windows-speech' | 'local-speech' | 'none'

export type VoiceErrorCode =
  /** No engine on this system (Linux), or the helper is missing from this build. */
  | 'unsupported'
  /** The engine exists but cannot run right now (no network for a server recognizer, service off). */
  | 'unavailable'
  /** No recognizer for any usable language. */
  | 'no-recognizer'
  | 'mic-denied'
  | 'speech-denied'
  /** The microphone could not be opened. */
  | 'audio'
  /** Another utterance is still being listened to. */
  | 'busy'
  | 'failed'

export interface VoiceAvailability {
  available: boolean
  engine: VoiceEngineName
  /** True when speech is recognized on this computer (nothing is sent anywhere). */
  onDevice: boolean
  /** Why it is not available, in a sentence for the user. */
  reason?: string
}

/** One message of a listening session, sent to the window that started it. */
export type VoiceEvent =
  | { type: 'ready' }
  /** The words so far; replaces the previous partial. */
  | { type: 'partial'; text: string }
  /** The last words; the session is over. */
  | { type: 'final'; text: string }
  /** The session is over without a result. */
  | { type: 'error'; code: VoiceErrorCode; message: string }

export interface VoiceEventEnvelope {
  sessionId: number
  event: VoiceEvent
}

export type VoiceStartResult =
  | { success: true; sessionId: number }
  | { success: false; code: VoiceErrorCode; error: string }
