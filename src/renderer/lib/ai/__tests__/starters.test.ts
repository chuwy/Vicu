import { describe, expect, it } from 'vitest'
import { ASK_STARTERS } from '../../../../shared/ai/contract'
import { starterKind, startersFor } from '../starters'

// docs/ai-assistant-v1.md section 5.7: the starters by the kind of list Ask was opened from.
describe('Ask starters', () => {
  it('picks the kind from the list on screen', () => {
    expect(starterKind('/today', 1)).toBe('today')
    expect(starterKind('/upcoming', 1)).toBe('upcoming')
    expect(starterKind('/inbox', 1)).toBe('inbox')
    expect(starterKind('/', 1)).toBe('inbox')
    expect(starterKind('/project/1', 1)).toBe('inbox')
    expect(starterKind('/project/7', 1)).toBe('project')
    expect(starterKind('/anytime', 1)).toBe('other')
    expect(starterKind('/list/abc', 1)).toBe('other')
  })

  it('gives the fixture text as written', () => {
    expect(startersFor('/today', 1)).toEqual(ASK_STARTERS.today)
  })
})
