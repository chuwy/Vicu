import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeRoutinePayload, parseRoutineEnvelope, statusRecord, type RoutinePayload } from '../routines'

/** Fields a newer app adds survive this one (cross-app semantics 10.8), and a newer version is "update required" (10.7). */

function payload(over: Record<string, unknown> = {}): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'r1',
      name: 'Water plants',
      kind: 'CHORE',
      healthSubtype: null,
      amount: '',
      unit: '',
      iconName: 'drop',
      color: '#00AAFF',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2026-01-01' },
      slots: [{ id: 's1', label: 'Morning', period: 'MORNING', reminderMinutes: 480, reminderEnabled: false, followUpMinutes: 0 }],
      activeFrom: '2026-01-01',
      archived: false,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-01-01T08:00:00.000Z',
      updatedBy: 'a',
    },
    occurrences: {},
    prunedBefore: '',
    ...over,
  } as RoutinePayload
}

const encode = (json: unknown) => Buffer.from(JSON.stringify(json), 'utf8').toString('base64url')

describe('routine payloads keep what they do not know', () => {
  beforeEach(() => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges unknown top-level fields as a union, the server copy winning a field on both sides', () => {
    const local = payload({ onlyHere: 1, both: 'local' })
    const server = payload({ onlyThere: 2, both: 'server' })
    const merged = mergeRoutinePayload(local, server) as RoutinePayload & Record<string, unknown>
    expect(merged.onlyHere).toBe(1)
    expect(merged.onlyThere).toBe(2)
    expect(merged.both).toBe('server')
  })

  it("keeps the previous record's unknown fields when an occurrence is logged again", () => {
    const base = payload()
    const key = 'r1:2026-10-06:s1'
    const withRecord = payload({
      occurrences: {
        [key]: {
          key, routineId: 'r1', slotId: 's1', scheduledDate: '2026-10-06', scheduledMinutes: 480, timeZoneId: 'UTC',
          status: 'PENDING', loggedAt: '', modifiedAt: '2026-10-06T07:00:00.000Z', modifiedBy: 'b', note: '', mood: 'calm',
        },
      },
    })
    const record = statusRecord(withRecord, '2026-10-06', base.definition.slots[0], 'COMPLETED')
    expect((record as unknown as { mood?: string }).mood).toBe('calm')
    expect(record.status).toBe('COMPLETED')
    expect(record.modifiedAt).not.toBe('2026-10-06T07:00:00.000Z')
  })

  it('reports a newer marker or payload version as update required, not as damaged', () => {
    expect(parseRoutineEnvelope('<!-- vicu-routine:v2:e30 -->')).toMatchObject({ isCarrier: true, updateRequired: true })
    expect(parseRoutineEnvelope(`<!-- vicu-routine:v1:${encode({ ...payload(), version: 2 })} -->`)).toMatchObject({ isCarrier: true, updateRequired: true })
    expect(parseRoutineEnvelope('<!-- vicu-routine:v1:e30 -->').updateRequired).toBeUndefined()
  })
})
