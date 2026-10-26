import { openMicOwner, openMicVoice } from './open-mic'

/**
 * Talk's answers read aloud with the system voice (docs/ai-assistant-v1.md section 6). With Ask's
 * open microphone on, it pauses while the voice speaks, because it would hear the voice, and
 * listens again when the voice ends (3.7).
 */

/** The utterance being read; an older one ending (cancelled by a newer one) changes nothing. */
let current: SpeechSynthesisUtterance | null = null

export function speakAnswer(text: string): void {
  if (!text || typeof window.speechSynthesis === 'undefined') return
  current = null
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = navigator.language
  const ended = () => {
    if (current !== utterance) return
    current = null
    openMicVoice(false)
  }
  utterance.onend = ended
  utterance.onerror = ended
  current = utterance
  if (openMicOwner() === 'ask') openMicVoice(true)
  window.speechSynthesis.speak(utterance)
}

/** Stops the voice; an open microphone paused for it listens again at once. */
export function stopSpeaking(): void {
  current = null
  if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel()
  openMicVoice(false)
}
