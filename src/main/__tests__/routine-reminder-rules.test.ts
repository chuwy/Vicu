import { describe, expect, it } from 'vitest'
import { occurrenceStillOpen, routineRemindsHere, type RoutineReminderContext } from '../routine-reminder-rules'
import type { RoutinePayload } from '../../shared/routines'

// Whose routine reminders ring here (docs/cross-app-semantics-v1.md section 6.9).

const ME = 7

function payload(shared?: boolean, occurrences: RoutinePayload['occurrences'] = {}): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'feed-cat', name: 'Feed the cat', kind: 'HEALTH', healthSubtype: null, amount: '', unit: '', iconName: '', color: '',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2026-01-01' },
      slots: [{ id: 's1', label: '08:00', period: 'MORNING', reminderMinutes: 480, reminderEnabled: true, followUpMinutes: 0 }],
      activeFrom: '2026-01-01', archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'x',
      ...(shared === undefined ? {} : { shared }),
    },
    occurrences,
    prunedBefore: '',
  }
}

function context(prefs: Record<string, unknown> = {}, permission: number | null = 1): RoutineReminderContext {
  return { me: ME, prefs, permissionOf: () => permission }
}

const mine = { created_by: { id: ME }, project_id: 36 }
const mayas = { created_by: { id: 2 }, project_id: 36 }

describe('routine reminders here', () => {
  it('a private routine reminds by its own settings', () => {
    expect(routineRemindsHere(mine, payload(), context({ 'routine_reminders.feed-cat': 'off', 'routine_hidden.feed-cat': true }))).toBe(true)
  })

  it("the owner of a shared routine is reminded whatever the per-person keys say", () => {
    expect(routineRemindsHere(mine, payload(true), context({ 'routine_reminders.feed-cat': 'off' }, 0))).toBe(true)
  })

  it('a member is reminded by default, not once they turned it off or hid it', () => {
    expect(routineRemindsHere(mayas, payload(true), context())).toBe(true)
    expect(routineRemindsHere(mayas, payload(true), context({ 'routine_reminders.feed-cat': 'off' }))).toBe(false)
    expect(routineRemindsHere(mayas, payload(true), context({ 'routine_hidden.feed-cat': true }))).toBe(false)
    // Any other value acts as the default (section 11.3).
    expect(routineRemindsHere(mayas, payload(true), context({ 'routine_reminders.feed-cat': 'loud', 'routine_hidden.feed-cat': 'yes' }))).toBe(true)
  })

  it('a member who can only view the project gets none; an unknown permission counts as write', () => {
    expect(routineRemindsHere(mayas, payload(true), context({}, 0))).toBe(false)
    expect(routineRemindsHere(mayas, payload(true), context({}, null))).toBe(true)
    expect(routineRemindsHere(mayas, payload(true), context({}, 2))).toBe(true)
  })

  it('an occurrence someone completed or skipped no longer reminds', () => {
    const record = (status: 'COMPLETED' | 'SKIPPED' | 'NOT_LOGGED' | 'PENDING') => ({
      'feed-cat:2026-10-06:s1': {
        key: 'feed-cat:2026-10-06:s1', routineId: 'feed-cat', slotId: 's1', scheduledDate: '2026-10-06', scheduledMinutes: 480,
        timeZoneId: 'UTC', status, loggedAt: '', modifiedAt: '2026-10-06T07:00:00.000Z', modifiedBy: 'maya', note: '',
      },
    })
    expect(occurrenceStillOpen(payload(true), 'feed-cat:2026-10-06:s1')).toBe(true)
    expect(occurrenceStillOpen(payload(true, record('PENDING')), 'feed-cat:2026-10-06:s1')).toBe(true)
    expect(occurrenceStillOpen(payload(true, record('COMPLETED')), 'feed-cat:2026-10-06:s1')).toBe(false)
    expect(occurrenceStillOpen(payload(true, record('SKIPPED')), 'feed-cat:2026-10-06:s1')).toBe(false)
  })
})
