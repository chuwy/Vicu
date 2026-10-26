import { describe, expect, it } from 'vitest'
import { normaliseSpokenAnswer, spokenConfirmation } from '../talk'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 6.1 against `talk.confirmVectors`.
describe('spoken confirmation (fixture vectors)', () => {
  for (const vector of aiFixture.talk.confirmVectors) {
    it(`${vector.language} "${vector.text}" is ${vector.expect}`, () => {
      expect(spokenConfirmation(vector.text, vector.language)).toBe(vector.expect)
    })
  }

  it('normalises case, curly apostrophes, punctuation and spaces', () => {
    expect(normaliseSpokenAnswer('  Okay,  DO it! ')).toBe('okay do it')
    expect(normaliseSpokenAnswer('That’s right.')).toBe("that's right")
  })
})
