import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSER_CONFIG } from '../../task-parser'
import { dateOnlyDue } from '../../due-dates'
import { cleanTranscript, defaultReminder, voiceConfirmation, voiceTaskDraft, type VoiceTaskContext } from '../voice-task'

// Wednesday 21 October 2026, 10:00 local.
const now = new Date(2026, 9, 21, 10, 0, 0)
const ctx: VoiceTaskContext = {
  parserConfig: { ...DEFAULT_PARSER_CONFIG, bangToday: true, locale: 'en-GB' },
  projects: [
    { id: 1, title: 'Inbox' },
    { id: 7, title: 'Work' },
    { id: 9, title: 'Family' },
  ],
  inboxProjectId: 1,
  now,
}
const gb24 = { locale: 'en-GB', hour12: false }

function ok(text: string, extra: Partial<VoiceTaskContext> = {}) {
  const draft = voiceTaskDraft(text, { ...ctx, ...extra })
  if (!draft.ok) throw new Error(`expected a task from "${text}": ${draft.message}`)
  return draft
}

describe('voiceTaskDraft', () => {
  it('reads a date and time like quick add and goes to the Inbox', () => {
    const draft = ok('Call mom tomorrow 3pm')
    expect(draft.title).toBe('Call mom')
    expect(draft.projectId).toBe(1)
    expect(draft.projectTitle).toBeNull()
    expect(new Date(draft.payload.due_date!)).toEqual(new Date(2026, 9, 22, 15, 0, 0))
    expect(draft.payload.reminders).toBeUndefined()
  })

  it('reads the way a recognizer writes a time ("3 PM")', () => {
    const draft = ok('Call mom tomorrow at 3 PM')
    expect(draft.title).toBe('Call mom')
    expect(new Date(draft.payload.due_date!)).toEqual(new Date(2026, 9, 22, 15, 0, 0))
  })

  it('a date without a time is date-only (local 23:59:59)', () => {
    expect(ok('Pay rent tomorrow').payload.due_date).toBe(dateOnlyDue('2026-10-22'))
  })

  it('goes to the project the text names, and only then', () => {
    const draft = ok('Quarterly report #Work')
    expect(draft.title).toBe('Quarterly report')
    expect(draft.projectId).toBe(7)
    expect(draft.projectTitle).toBe('Work')
    expect(ok('Plan trip #Nowhere').projectId).toBe(1)
  })

  it('collects labels, priority and repeating', () => {
    const draft = ok('Water plants every week @home p1')
    expect(draft.title).toBe('Water plants')
    expect(draft.labelNames).toEqual(['home'])
    expect(draft.payload.priority).toBeGreaterThan(0)
    expect(draft.payload.repeat_after).toBe(7 * 86400)
  })

  it('drops the full stop a recognizer adds', () => {
    expect(ok('Buy milk.').title).toBe('Buy milk')
    expect(cleanTranscript('  Buy   milk .  ')).toBe('Buy milk')
  })

  it('with the parser off keeps every word in the title', () => {
    const draft = ok('Call mom tomorrow', { parserConfig: { ...ctx.parserConfig, enabled: false } })
    expect(draft.title).toBe('Call mom tomorrow')
    expect(draft.payload.due_date).toBeUndefined()
  })

  it('adds the default reminder to a task with a due date', () => {
    const draft = ok('Call mom tomorrow 3pm', { reminderOffset: 900, reminderRelativeTo: 'due_date' })
    expect(draft.payload.reminders).toEqual([
      { reminder: new Date(2026, 9, 22, 14, 45, 0).toISOString(), relative_period: -900, relative_to: 'due_date' },
    ])
    expect(ok('Call mom', { reminderOffset: 900 }).payload.reminders).toBeUndefined()
  })

  it('says why nothing can be added', () => {
    expect(voiceTaskDraft('   ', ctx)).toMatchObject({ ok: false, reason: 'empty' })
    expect(voiceTaskDraft('tomorrow 3pm', ctx)).toMatchObject({ ok: false, reason: 'empty' })
    expect(voiceTaskDraft('Call mom', { ...ctx, inboxProjectId: 0 })).toMatchObject({ ok: false, reason: 'no-inbox' })
  })
})

describe('defaultReminder', () => {
  const due = new Date(2026, 9, 22, 15, 0, 0).toISOString()
  it('follows the setting: none, at the due time, or seconds before', () => {
    expect(defaultReminder(due, 0)).toBeNull()
    expect(defaultReminder(due, undefined)).toBeNull()
    expect(defaultReminder(null, 900)).toBeNull()
    expect(defaultReminder(due, -1)).toEqual({ reminder: due, relative_period: 0, relative_to: 'due_date' })
    expect(defaultReminder(due, 3600, 'start_date')).toEqual({
      reminder: new Date(2026, 9, 22, 14, 0, 0).toISOString(),
      relative_period: -3600,
      relative_to: 'start_date',
    })
  })
})

describe('voiceConfirmation', () => {
  it('says what was added with the row date phrase', () => {
    expect(voiceConfirmation(ok('Call mom tomorrow 3pm'), now, gb24)).toBe('Added “Call mom”, tomorrow, 15:00')
    expect(voiceConfirmation(ok('Pay rent today'), now, gb24)).toBe('Added “Pay rent”, today')
    expect(voiceConfirmation(ok('Quarterly report #Work'), now, gb24)).toBe('Added “Quarterly report” to Work')
    expect(voiceConfirmation(ok('Buy milk'), now, gb24)).toBe('Added “Buy milk”')
  })

  it('uses the 12-hour clock where the format says so', () => {
    expect(voiceConfirmation(ok('Call mom tomorrow 3pm'), now, { locale: 'en-US', hour12: true })).toBe('Added “Call mom”, tomorrow, 3:00 PM')
  })
})
