import { describe, expect, it } from 'vitest'
import { NULL_DATE } from '../../constants'
import { dateOnlyDue } from '../../due-dates'
import { task } from '../../ai/__tests__/helpers'
import type { Suggestion } from '../../../../shared/ai/organize'
import {
  draftChanges,
  draftOf,
  logChange,
  logComplete,
  logDelete,
  sessionCounts,
  summaryText,
  undoPlan,
  withSuggestion,
  type SessionLog,
} from '../cards'

// docs/cross-app-semantics-v1.md section 14.3 and docs/ai-assistant-v1.md section 9.4.

const suggestion = (extra: Partial<Suggestion>): Suggestion => ({
  task_id: 1, title: null, project_id: null, due: null, due_has_time: false, clear_due: false, close: null, reason: 'Why', ...extra,
})

describe('card drafts', () => {
  it('writes only what differs from the task as it is now', () => {
    const t = task(1, 'dentist', { project_id: 1 })
    expect(draftChanges(t, draftOf(t))).toEqual({})
    expect(draftChanges(t, { ...draftOf(t), title: '  Book the dentist\n' })).toEqual({ title: 'Book the dentist' })
    expect(draftChanges(t, { ...draftOf(t), title: '   ' })).toEqual({})
    const due = dateOnlyDue('2026-10-30')
    expect(draftChanges(t, { ...draftOf(t), projectId: 3, due })).toEqual({ project_id: 3, due_date: due })
  })

  it('clears a date with the null date and treats the same instant as no change', () => {
    const due = dateOnlyDue('2026-10-30')
    const t = task(1, 'x', { due_date: due })
    expect(draftChanges(t, { ...draftOf(t), due: NULL_DATE })).toEqual({ due_date: NULL_DATE })
    expect(draftChanges(t, { ...draftOf(t), due: new Date(due).toISOString() })).toEqual({})
  })

  it('lays a suggestion on the card and says which choices it filled in', () => {
    const t = task(1, 'dentist', { project_id: 1, due_date: dateOnlyDue('2026-10-01') })
    const { draft, suggested } = withSuggestion(t, suggestion({ title: 'Book a dentist check-up', project_id: 12, due: '2026-10-09T23:59:59' }))
    expect(draft).toEqual({ title: 'Book a dentist check-up', projectId: 12, due: dateOnlyDue('2026-10-09') })
    expect([...suggested]).toEqual(['title', 'project', 'when'])
    const cleared = withSuggestion(t, suggestion({ clear_due: true }))
    expect(cleared.draft.due).toBe(NULL_DATE)
    expect([...cleared.suggested]).toEqual(['when'])
    expect(withSuggestion(t, null).suggested.size).toBe(0)
  })
})

describe('what a session changed', () => {
  const a = task(1, 'a', { project_id: 1 })
  const b = task(2, 'b', { project_id: 1, due_date: dateOnlyDue('2026-10-01') })
  const c = task(3, 'c', { project_id: 1 })
  const d = task(4, 'd', { project_id: 1 })

  function sample(): SessionLog {
    let log: SessionLog = new Map()
    log = logChange(log, a, { due_date: dateOnlyDue('2026-10-30'), project_id: 5 })
    log = logChange(log, b, { due_date: NULL_DATE })
    log = logComplete(log, c)
    log = logDelete(log, d)
    return log
  }

  it('counts each task once in "sorted" and every kind of change', () => {
    expect(sessionCounts(sample())).toEqual({ sorted: 4, scheduled: 1, unscheduled: 1, moved: 1, renamed: 0, completed: 1, deleted: 1 })
    expect(summaryText(sessionCounts(sample()))).toBe('Sorted 4: 1 scheduled, 1 without a date now, 1 moved, 1 completed, 1 deleted')
    expect(summaryText(sessionCounts(new Map()))).toBe('Nothing changed')
  })

  it('keeps the first "before" when a card is changed again after Back', () => {
    let log: SessionLog = new Map()
    log = logChange(log, a, { project_id: 5 })
    log = logChange(log, { ...a, project_id: 5 }, { project_id: 1 })
    expect(sessionCounts(log).sorted).toBe(0)
  })

  it('puts back everything except deletes', () => {
    const steps = undoPlan(sample())
    expect(steps.map((step) => step.type === 'patch' ? [step.type, step.id, step.changes] : [step.type, step.task.id])).toEqual([
      ['patch', 1, { project_id: 1, due_date: NULL_DATE }],
      ['patch', 2, { due_date: dateOnlyDue('2026-10-01') }],
      ['reopen', 3],
    ])
  })
})
