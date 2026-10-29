// The plain day grid behind the Planner's right-side day calendar (docs/calendar.md).
// No events yet: this is only the layout model — the 30-minute slots and their hour marks.

export const DAY_SLOT_MINUTES = 30
export const DAY_SLOT_COUNT = (24 * 60) / DAY_SLOT_MINUTES

export interface DayTimeSlot {
  /** Minutes from local midnight: 0, 30, 60, ... 1410. */
  minutesFromMidnight: number
  /** The slot starts an hour: its line is the more solid one and only hours carry a label. */
  isHour: boolean
  /** Local start of the slot. */
  start: Date
  /** Local ISO minute precision ("2026-06-10T09:00") for a `<time dateTime>`. */
  isoLocal: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * The 48 half-hour slots of one local day, in order. `dayStart` is any instant of that local day
 * (normally `startOfLocalDay`). Slot times are built with the local Date constructor from the
 * calendar date, so a daylight-saving shift does not move them off their wall-clock time.
 */
export function dayTimeSlots(dayStart: Date): DayTimeSlot[] {
  const year = dayStart.getFullYear()
  const month = dayStart.getMonth()
  const date = dayStart.getDate()
  const isoDay = `${year}-${pad2(month + 1)}-${pad2(date)}`
  return Array.from({ length: DAY_SLOT_COUNT }, (_, index) => {
    const minutesFromMidnight = index * DAY_SLOT_MINUTES
    return {
      minutesFromMidnight,
      isHour: minutesFromMidnight % 60 === 0,
      start: new Date(year, month, date, 0, minutesFromMidnight),
      isoLocal: `${isoDay}T${pad2(Math.floor(minutesFromMidnight / 60))}:${pad2(minutesFromMidnight % 60)}`,
    }
  })
}
