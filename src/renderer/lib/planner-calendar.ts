import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import { PLANNER_DEFAULT_DURATION_MINUTES, plannerTaskSortKey } from '@/lib/planner'
import { parseTaskDuration } from '@/lib/task-duration'
import { DAY_SLOT_HEIGHT_PX, DAY_SLOT_MINUTES } from '@/lib/day-calendar'

const MINUTE_MS = 60_000
const DAY_MINUTES = 24 * 60
/** Minimum readable height for short blocks, also used when assigning overlap columns. */
export const CALENDAR_EVENT_MIN_HEIGHT_PX = 24
const MIN_EVENT_MINUTES = CALENDAR_EVENT_MIN_HEIGHT_PX * DAY_SLOT_MINUTES / DAY_SLOT_HEIGHT_PX

export interface PlannerCalendarEvent {
  task: Task
  /** Real instants; absent duration uses Planner's 30-minute default without storing metadata. */
  start: Date
  end: Date
  /** Display bounds in the fixed 24-hour wall-clock grid, clipped to this day. */
  startMinute: number
  endMinute: number
  column: number
  columnCount: number
}

export interface PlannerCalendarEvents {
  timed: PlannerCalendarEvent[]
}

const wallMinute = (date: Date): number => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60

/** Greedy interval partitioning; a connected overlap group shares its maximum column count. */
function layoutOverlaps(events: PlannerCalendarEvent[]): PlannerCalendarEvent[] {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.task.id - b.task.id)
  const result: PlannerCalendarEvent[] = []
  let group: PlannerCalendarEvent[] = []
  let columnEnds: number[] = []
  let groupEnd = -1
  const flush = () => {
    result.push(...group.map((event) => ({ ...event, columnCount: columnEnds.length })))
    group = []
    columnEnds = []
  }

  for (const event of sorted) {
    if (event.startMinute >= groupEnd) flush()
    let column = columnEnds.findIndex((end) => end <= event.startMinute)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = event.endMinute
    group.push({ ...event, column })
    groupEnd = Math.max(...columnEnds)
  }
  flush()
  return result
}

/**
 * Map tasks with a start_date to the selected local day, including overlapping overnight blocks.
 * Missing duration defaults to 30 minutes; due_date and end_date are never involved.
 */
export function plannerCalendarEvents(
  tasks: readonly Task[],
  activeProjectIds: ReadonlySet<number>,
  day: Date,
): PlannerCalendarEvents {
  const date = toLocalDate(day)
  const dayStart = startOfLocalDay(date).getTime()
  const dayEnd = startOfLocalDay(addLocalDays(date, 1)).getTime()
  const timed: PlannerCalendarEvent[] = []

  for (const task of tasks) {
    if (!activeProjectIds.has(task.project_id)) continue
    const startMs = plannerTaskSortKey(task)
    if (startMs === null) continue
    const duration = parseTaskDuration(task.description) ?? PLANNER_DEFAULT_DURATION_MINUTES
    const endMs = startMs + duration * MINUTE_MS
    const start = new Date(startMs)
    const end = new Date(endMs)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue
    if (startMs >= dayEnd || endMs <= dayStart) continue

    const startMinute = startMs < dayStart ? 0 : wallMinute(start)
    const endMinute = endMs >= dayEnd ? DAY_MINUTES : wallMinute(end)
    // Repeated DST hours share a line. A backwards wall-clock interval still gets a visible marker.
    const displayStart = Math.min(startMinute, DAY_MINUTES - MIN_EVENT_MINUTES)
    timed.push({
      task, start, end,
      startMinute: displayStart,
      endMinute: Math.min(DAY_MINUTES, Math.max(endMinute, displayStart + MIN_EVENT_MINUTES)),
      column: 0,
      columnCount: 1,
    })
  }

  return { timed: layoutOverlaps(timed) }
}
