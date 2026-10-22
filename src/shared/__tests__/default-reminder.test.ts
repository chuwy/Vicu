import { describe, expect, it } from 'vitest'
import { buildDefaultReminder, withDefaultReminder } from '../default-reminder'
import { dateOnlyDue } from '../due-dates'

// The same cases as Android's DefaultReminder.build (offset 0 off, -1 at the due time, seconds
// before otherwise; relative to the setting's date; nothing without a due date).

const due = '2026-10-22T13:00:00.000Z'

describe('buildDefaultReminder', () => {
  it('is off for offset 0 or no setting', () => {
    expect(buildDefaultReminder(due, 0)).toBeNull()
    expect(buildDefaultReminder(due, undefined)).toBeNull()
    expect(buildDefaultReminder(due, null)).toBeNull()
  })

  it('needs a due date', () => {
    expect(buildDefaultReminder(null, 900)).toBeNull()
    expect(buildDefaultReminder('', 900)).toBeNull()
    expect(buildDefaultReminder('0001-01-01T00:00:00Z', 900)).toBeNull()
    expect(buildDefaultReminder('not a date', 900)).toBeNull()
  })

  it('-1 is at the due time, relative period 0', () => {
    expect(buildDefaultReminder(due, -1)).toEqual({ reminder: due, relative_period: 0, relative_to: 'due_date' })
  })

  it('a positive offset is that many seconds before, as a negative relative period', () => {
    expect(buildDefaultReminder(due, 900)).toEqual({ reminder: '2026-10-22T12:45:00.000Z', relative_period: -900, relative_to: 'due_date' })
    expect(buildDefaultReminder(due, 86400)).toEqual({ reminder: '2026-10-21T13:00:00.000Z', relative_period: -86400, relative_to: 'due_date' })
  })

  it('keeps the relative_to of the setting', () => {
    expect(buildDefaultReminder(due, 3600, 'start_date')?.relative_to).toBe('start_date')
    expect(buildDefaultReminder(due, -1, 'end_date')?.relative_to).toBe('end_date')
  })

  it('counts from the stored value of a date-only due date (23:59:59 local)', () => {
    const dateOnly = dateOnlyDue('2026-10-22')
    const reminder = buildDefaultReminder(dateOnly, 3600)!
    const at = new Date(reminder.reminder)
    expect([at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([22, 22, 59, 59])
  })
})

describe('withDefaultReminder', () => {
  const settings = { notifications_default_reminder_offset: 900, notifications_default_reminder_relative_to: 'due_date' as const }

  it('adds the reminder to a new task with a due date', () => {
    expect(withDefaultReminder({ title: 'Call', due_date: due }, settings).reminders).toEqual([
      { reminder: '2026-10-22T12:45:00.000Z', relative_period: -900, relative_to: 'due_date' },
    ])
  })

  it('keeps reminders the user picked', () => {
    const picked = [{ reminder: '2026-10-22T08:00:00.000Z' }]
    expect(withDefaultReminder({ title: 'Call', due_date: due, reminders: picked }, settings).reminders).toBe(picked)
  })

  it('leaves a task without a due date, or with the setting off, as it was', () => {
    const undated = { title: 'Call' }
    expect(withDefaultReminder(undated, settings)).toBe(undated)
    const dated = { title: 'Call', due_date: due }
    expect(withDefaultReminder(dated, { notifications_default_reminder_offset: 0 })).toBe(dated)
    expect(withDefaultReminder(dated, null)).toBe(dated)
  })

  it('defaults relative_to to the due date', () => {
    expect(withDefaultReminder({ title: 'Call', due_date: due }, { notifications_default_reminder_offset: -1 }).reminders).toEqual([
      { reminder: due, relative_period: 0, relative_to: 'due_date' },
    ])
  })
})
