import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, isDateOnly, isNoDueDate, localDateOf, startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import { plannerTaskSortKey } from '@/lib/planner'
import { parseTaskDuration } from '@/lib/task-duration'
import { DAY_SLOT_HEIGHT_PX, DAY_SLOT_MINUTES } from '@/lib/day-calendar'

const MINUTE_MS = 60_000
const DAY_MINUTES = 24 * 60
/** A readable marker, not an invented task duration. Also used when assigning overlap columns. */
export const CALENDAR_EVENT_MIN_HEIGHT_PX = 24
const MIN_EVENT_MINUTES = CALENDAR_EVENT_MIN_HEIGHT_PX * DAY_SLOT_MINUTES / DAY_SLOT_HEIGHT_PX

export interface PlannerCalendarEvent {
  task: Task
  /** Real instants; an absent duration is a point, not a guessed half-hour appointment. */
  start: Date
  end: Date | null
  /** Display bounds in the fixed 24-hour wall-clock grid, clipped to this day. */
  startMinute: number
  endMinute: number
  column: number
  columnCount: number
}

export interface PlannerCalendarEvents {
  timed: PlannerCalendarEvent[]
  anytime: Task[]
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
 * Map the Planner's loaded tasks to the selected local day. Start wins, otherwise timed due minus
 * duration; end_date is never involved. Date-only due tasks have no invented time. The calendar is
 * read-only and may show a task on a different day from its due-date-based Planner column.
 */
export function plannerCalendarEvents(
  tasks: readonly Task[],
  activeProjectIds: ReadonlySet<number>,
  day: Date,
): PlannerCalendarEvents {
  const date = toLocalDate(day)
  const dayStart = startOfLocalDay(date).getTime()
  const dayEnd = startOfLocalDay(addLocalDays(date, 1)).getTime()
  const anytime: Task[] = []
  const timed: PlannerCalendarEvent[] = []

  for (const task of tasks) {
    if (!activeProjectIds.has(task.project_id)) continue
    if (isNoDueDate(task.start_date) && isDateOnly(task.due_date)) {
      if (localDateOf(task.due_date) === date) anytime.push(task)
      continue
    }
    const startMs = plannerTaskSortKey(task)
    if (startMs === null) continue
    const duration = parseTaskDuration(task.description)
    const endMs = duration === null ? startMs : startMs + duration * MINUTE_MS
    const start = new Date(startMs)
    const end = duration === null ? null : new Date(endMs)
    if (!Number.isFinite(start.getTime()) || (end && !Number.isFinite(end.getTime()))) continue
    if (startMs >= dayEnd || (duration === null ? startMs < dayStart : endMs <= dayStart)) continue

    const startMinute = startMs < dayStart ? 0 : wallMinute(start)
    const endMinute = endMs >= dayEnd ? DAY_MINUTES : wallMinute(end ?? start)
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

  return { timed: layoutOverlaps(timed), anytime }
}
