import type { PlannerCalendarEvent } from '@/lib/planner-calendar'
import { parseTaskDuration, withTaskDuration } from '@/lib/task-duration'
import type { Task } from '@/lib/vikunja-types'

export type CalendarEditMode = 'move' | 'start' | 'end'
export const CALENDAR_SNAP_MINUTES = 15
const MINUTE_MS = 60_000

export function snapCalendarMinutes(minutes: number): number {
  return Math.sign(minutes) * Math.round(Math.abs(minutes) / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES
}

/** Move on the wall-clock grid, keeping elapsed duration independent of DST. */
function shiftWallMinutes(date: Date, minutes: number): number {
  const shifted = new Date(date)
  shifted.setMinutes(shifted.getMinutes() + minutes)
  const elapsed = new Date(date.getTime() + minutes * MINUTE_MS)
  // setMinutes picks the first occurrence of a repeated hour. Keep the current occurrence
  // when elapsed movement reaches the same wall time, rather than jumping an hour backwards.
  if (elapsed.getFullYear() === shifted.getFullYear() && elapsed.getMonth() === shifted.getMonth()
    && elapsed.getDate() === shifted.getDate() && elapsed.getHours() === shifted.getHours()
    && elapsed.getMinutes() === shifted.getMinutes()) return elapsed.getTime()
  // A missing spring-forward hour must not turn an upward gesture into a later instant.
  if (Math.sign(shifted.getTime() - date.getTime()) !== Math.sign(minutes)) return elapsed.getTime()
  return shifted.getTime()
}

/**
 * Only scheduling fields the gesture actually changes. Moves preserve absent duration metadata;
 * resizing uses the effective end (including the 30-minute default), not the display box.
 */
export function calendarEditChanges(
  event: PlannerCalendarEvent,
  mode: CalendarEditMode,
  deltaMinutes: number,
): Partial<Task> {
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) return {}
  const start = event.start.getTime()
  const end = event.end.getTime()
  if (mode === 'move') {
    return { start_date: new Date(shiftWallMinutes(event.start, deltaMinutes)).toISOString() }
  }

  const nextStart = mode === 'start'
    ? Math.min(shiftWallMinutes(event.start, deltaMinutes), end - MINUTE_MS)
    : start
  const nextEnd = mode === 'end'
    ? Math.max(shiftWallMinutes(event.end, deltaMinutes), start + MINUTE_MS)
    : end
  const duration = Math.max(1, Math.round((nextEnd - nextStart) / MINUTE_MS))
  const changes: Partial<Task> = {}
  const startDate = new Date(nextStart).toISOString()
  if (new Date(event.task.start_date).getTime() !== nextStart) changes.start_date = startDate
  if (duration !== parseTaskDuration(event.task.description)) {
    changes.description = withTaskDuration(event.task.description, duration)
  }
  return changes
}
