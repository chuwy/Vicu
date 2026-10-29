import { describe, expect, it } from 'vitest'
import { dayOpenSlotIndex, dayTimeSlots, DAY_SLOT_COUNT, DAY_SLOT_MINUTES } from '@/lib/day-calendar'

// The slots are local wall times; Auckland (UTC+12/+13) catches a UTC assumption.
process.env.TZ = 'Pacific/Auckland'

describe('dayTimeSlots', () => {
  it('covers the local day with 48 half-hour slots', () => {
    const slots = dayTimeSlots(new Date(2026, 5, 10, 12))

    expect(DAY_SLOT_MINUTES).toBe(30)
    expect(slots).toHaveLength(DAY_SLOT_COUNT)
    expect(slots[0]).toMatchObject({ minutesFromMidnight: 0, isHour: true })
    expect(slots[1]).toMatchObject({ minutesFromMidnight: 30, isHour: false })
    expect(slots[slots.length - 1]).toMatchObject({ minutesFromMidnight: 23 * 60 + 30, isHour: false })
  })

  it('steps through the day in wall-clock time and marks every hour', () => {
    const slots = dayTimeSlots(new Date(2026, 5, 10, 12))

    slots.forEach((slot, index) => {
      expect(slot.start.getHours(), `slot ${index}`).toBe(Math.floor(index / 2))
      expect(slot.start.getMinutes(), `slot ${index}`).toBe((index % 2) * 30)
      expect(slot.isHour, `slot ${index}`).toBe(slot.minutesFromMidnight % 60 === 0)
    })
    expect(slots.filter((slot) => slot.isHour)).toHaveLength(24)
  })

  it('labels slots with a local ISO minute-precision timestamp', () => {
    const slots = dayTimeSlots(new Date(2026, 5, 10, 12))

    expect(slots[0].isoLocal).toBe('2026-06-10T00:00')
    expect(slots[1].isoLocal).toBe('2026-06-10T00:30')
    expect(slots[18].isoLocal).toBe('2026-06-10T09:00')
    expect(slots[47].isoLocal).toBe('2026-06-10T23:30')
  })

  it('opens one hour before now for today, 8 AM for any other day', () => {
    // 14:37 today opens at the 13:30 block (the block containing 13:37).
    expect(dayOpenSlotIndex(true, new Date(2026, 5, 10, 14, 37))).toBe(27)
    // 09:00 today opens at the 08:00 hour line.
    expect(dayOpenSlotIndex(true, new Date(2026, 5, 10, 9, 0))).toBe(16)
    // An hour before now is still yesterday's side of the day: clamp to the top.
    expect(dayOpenSlotIndex(true, new Date(2026, 5, 10, 0, 30))).toBe(0)
    expect(dayOpenSlotIndex(false, new Date(2026, 5, 10, 14, 37))).toBe(16)
    expect(dayOpenSlotIndex(false, new Date(2026, 5, 10, 7, 59))).toBe(16)
  })
})
