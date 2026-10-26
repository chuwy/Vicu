/**
 * Spoken confirmation of an open proposal card (docs/ai-assistant-v1.md section 6.1). Vectors:
 * `talk.confirmVectors`.
 */
import { TALK_CONFIRM } from './contract'

export type SpokenAnswer = 'yes' | 'no' | 'other'

/** Unicode lowercase, curly apostrophes straight, `. , ! ? ; :` as spaces, spaces collapsed, trimmed. */
export function normaliseSpokenAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Yes or no when the transcript is exactly one of the language's phrases; anything else goes to the model. */
export function spokenConfirmation(text: string, language: string): SpokenAnswer {
  const phrases = TALK_CONFIRM[language]
  if (!phrases) return 'other'
  const said = normaliseSpokenAnswer(text)
  if (phrases.yes.includes(said)) return 'yes'
  if (phrases.no.includes(said)) return 'no'
  return 'other'
}
