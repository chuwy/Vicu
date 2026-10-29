import type { Task } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import { parseTaskDuration } from '@/lib/task-duration'
import {
  addLocalDays,
  diffLocalDays,
  localDateOf,
  postponeDays,
  startOfLocalDayIso,
  toLocalDate,
  type LocalDate,
} from '@/lib/due-dates'

export const PLANNER_DAY_COUNT = 3
const MINUTE_MS = 60_000

export interface PlannerDay {
  /** Null identifies the Overdue column; dated columns carry their local calendar date. */
  date: LocalDate | null
  tasks: Task[]
}

/**
 * Every task Planner shows: the dated window (completed included) plus all open tasks.
 * The Unplanned column needs open tasks with no dates, but Vikunja's filter engine treats the Go
 * zero time as "no date" and never matches it (`due_date = '0001-01-01T00:00:00Z'` returns
 * nothing), so unplanned tasks cannot be selected server-side: fetch `done = false` and pick them
 * out with `plannerUnplannedTasks`. The dated grouping drops open tasks outside the window.
 */
export function plannerTaskFilter(now: Date): string {
  const end = startOfLocalDayIso(PLANNER_DAY_COUNT, now)
  return `(due_date != '${NULL_DATE}' && due_date < '${end}') || done = false`
}

/** The due date after a Planner drop, or null when there is no date change to send. */
export function plannerDueDateOnDrop(dueDate: string, targetDate: LocalDate): string | null {
  const currentDate = localDateOf(dueDate)
  if (!currentDate || currentDate === targetDate) return null
  return postponeDays(dueDate, diffLocalDays(currentDate, targetDate))
}

function plannerTimestamp(value: string | null | undefined): number | null {
  if (!value || value === NULL_DATE) return null
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

/** Start date wins; otherwise Planner schedules the task backwards from due by its duration. */
export function plannerTaskSortKey(task: Task): number | null {
  const start = plannerTimestamp(task.start_date)
  if (start !== null) return start
  const due = plannerTimestamp(task.due_date)
  if (due === null) return null
  return due - (parseTaskDuration(task.description) ?? 0) * MINUTE_MS
}

function comparePlannerTasks(left: Task, right: Task): number {
  const leftKey = plannerTaskSortKey(left)
  const rightKey = plannerTaskSortKey(right)
  if (leftKey === null) return rightKey === null ? 0 : 1
  if (rightKey === null) return -1
  return leftKey - rightKey
}

/** Open tasks in active projects that have neither a due date nor a start date. */
export function plannerUnplannedTasks(tasks: Task[], activeProjectIds: ReadonlySet<number>): Task[] {
  return tasks.filter((task) => (
    !task.done
    && activeProjectIds.has(task.project_id)
    && plannerTimestamp(task.due_date) === null
    && plannerTimestamp(task.start_date) === null
  ))
}

/** Group open overdue tasks first, then all tasks by local date, always returning all four columns. */
export function groupPlannerTasks(
  tasks: Task[],
  activeProjectIds: ReadonlySet<number>,
  now: Date,
): PlannerDay[] {
  const today = toLocalDate(now)
  const overdueTasks: Task[] = []
  const days: PlannerDay[] = Array.from({ length: PLANNER_DAY_COUNT }, (_, offset) => ({
    date: addLocalDays(today, offset),
    tasks: [],
  }))
  const byDate = new Map(days.map((day) => [day.date, day.tasks]))

  // The server cannot order by hidden duration metadata. Stable sorting keeps the existing order
  // for equal keys, and grouping then preserves the effective order within every column.
  for (const task of [...tasks].sort(comparePlannerTasks)) {
    if (!activeProjectIds.has(task.project_id)) continue
    const dueDate = localDateOf(task.due_date)
    if (!dueDate) continue
    if (dueDate < today) {
      if (!task.done) overdueTasks.push(task)
      continue
    }
    const dayTasks = byDate.get(dueDate)
    if (dayTasks) dayTasks.push(task)
  }

  return [{ date: null, tasks: overdueTasks }, ...days]
}
