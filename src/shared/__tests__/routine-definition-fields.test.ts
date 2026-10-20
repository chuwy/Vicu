import { describe, expect, it } from 'vitest'
import { normalizeRoutineSlots, routineKindFor, type RoutineSlot } from '../routines'

// Contract 6.7: the editor sets times and a schedule; kind, label and period are still written
// for older app versions. The mobile app's RoutineDefinitionRulesTest checks the same rules.

const calendar = { type: 'calendar' as const, weekdays: [], weekInterval: 1, anchorDate: '2026-10-06' }
const afterCompletion = { type: 'after_completion' as const, intervalDays: 14, firstDueDate: '2026-10-06' }

function slot(id: string, minutes: number, extra: Partial<RoutineSlot> = {}): RoutineSlot {
  return { id, label: '', period: 'MORNING', reminderMinutes: minutes, reminderEnabled: true, followUpMinutes: 0, ...extra }
}

describe('routine definition fields', () => {
  it('writes an after-completion routine as a chore, otherwise keeps the stored kind (health when new)', () => {
    expect(routineKindFor(afterCompletion)).toBe('CHORE')
    expect(routineKindFor(afterCompletion, 'HEALTH')).toBe('CHORE')
    expect(routineKindFor(calendar)).toBe('HEALTH')
    expect(routineKindFor(calendar, 'CHORE')).toBe('CHORE')
  })

  it('orders the times, labels them HH:MM and never repeats a period', () => {
    const normalized = normalizeRoutineSlots([slot('c', 20 * 60), slot('a', 7 * 60), slot('b', 8 * 60), slot('d', 21 * 60), slot('e', 13 * 60)])
    expect(normalized.map((item) => item.id)).toEqual(['a', 'b', 'e', 'c', 'd'])
    expect(normalized.map((item) => item.label)).toEqual(['07:00', '08:00', '13:00', '20:00', '21:00'])
    expect(normalized.map((item) => item.period)).toEqual(['MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME', 'HOME'])
  })

  it('keeps everything else a slot carries', () => {
    const source = { ...slot('s1', 15 * 60, { reminderEnabled: false, followUpMinutes: 15 }), sound: 'chime' }
    expect(normalizeRoutineSlots([source])[0]).toEqual({ ...source, label: '15:00', period: 'AFTERNOON' })
  })
})
