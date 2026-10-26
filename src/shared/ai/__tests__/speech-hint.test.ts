import { describe, expect, it } from 'vitest'
import { vocabularyHint } from '../speech-hint'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 3.4 against `speech.hintVectors`.
describe('vocabulary hint (fixture vectors)', () => {
  for (const vector of aiFixture.speech.hintVectors) {
    it(vector.name, () => {
      expect(vocabularyHint(vector.projects, vector.labels, vector.places)).toBe(vector.expect)
    })
  }

  it('stays within 600 UTF-16 code units', () => {
    const projects = Array.from({ length: 80 }, (_, i) => ({ title: `Project number ${i} with words` }))
    const hint = vocabularyHint([{ title: 'Inbox', inbox: true }, ...projects], [], [])
    expect(hint!.length).toBeLessThanOrEqual(600)
    expect(hint!.endsWith('.')).toBe(true)
  })
})
