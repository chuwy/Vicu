import { describe, expect, it } from 'vitest'
import { AI_LIMITS } from '../contract'
import { cutAtSpace, organizeBatches, organizeNotes, organizeTaskEntry, organizeUserMessage, shouldPrefetch } from '../organize'

// docs/ai-assistant-v1.md section 9.1: the user message, the task entries and the batches.
describe('organize request', () => {
  it('puts each block tag on a line of its own: context, session, tasks', () => {
    const user = organizeUserMessage('{"now":"2026-10-06T10:00"}', 'inbox', [{ id: 1, title: 'milk' }])
    expect(user).toBe('<context>\n{"now":"2026-10-06T10:00"}\n</context>\n<session>\ninbox\n</session>\n<tasks>\n[{"id":1,"title":"milk"}]\n</tasks>')
  })

  it('adds created, changed and notes after the summary, in that order', () => {
    const entry = organizeTaskEntry({ id: 7, title: 'dentist', done: false }, { created: '2026-10-01', changed: null, notes: 'Call first' })
    expect(Object.keys(entry)).toEqual(['id', 'title', 'done', 'created', 'changed', 'notes'])
    expect(entry.notes).toBe('Call first')
  })

  it('cuts long notes at the last space before the limit and adds an ellipsis', () => {
    const max = AI_LIMITS.organize_notes_max_chars
    expect(organizeNotes('short')).toBe('short')
    const words = 'word '.repeat(max)
    const cut = organizeNotes(words)
    expect(cut.endsWith('word…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(max + 1)
    expect(organizeNotes('x'.repeat(max + 10))).toBe(`${'x'.repeat(max)}…`)
  })

  it('cuts at the last space at or before the limit', () => {
    expect(cutAtSpace('one two three', 7)).toBe('one two')
    expect(cutAtSpace('one two three', 6)).toBe('one')
    expect(cutAtSpace('abcdefgh', 4)).toBe('abcd')
  })

  it('sends the queue in batches and asks for the next one a few cards ahead', () => {
    const size = AI_LIMITS.organize_batch_max
    const queue = Array.from({ length: size * 2 + 3 }, (_, i) => i)
    expect(organizeBatches(queue).map((batch) => batch.length)).toEqual([size, size, 3])
    expect(shouldPrefetch(size - AI_LIMITS.organize_prefetch - 1, size)).toBe(false)
    expect(shouldPrefetch(size - AI_LIMITS.organize_prefetch, size)).toBe(true)
  })
})
