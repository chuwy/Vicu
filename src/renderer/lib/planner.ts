import type { Task } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
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

export interface PlannerDay {
  /** Null identifies the Overdue column; dated columns carry their local calendar date. */
  date: LocalDate | null
  tasks: Task[]
}

/** The server query for every overdue task and exactly the dated days Planner shows. */
export function plannerTaskFilter(now: Date): string {
  const end = startOfLocalDayIso(PLANNER_DAY_COUNT, now)
  return `done = false && due_date != '${NULL_DATE}' && due_date < '${end}'`
}

/** The due date after a Planner drop, or null when there is no date change to send. */
export function plannerDueDateOnDrop(dueDate: string, targetDate: LocalDate): string | null {
  const currentDate = localDateOf(dueDate)
  if (!currentDate || currentDate === targetDate) return null
  return postponeDays(dueDate, diffLocalDays(currentDate, targetDate))
}

/** Group overdue tasks first, then by local calendar date, always returning all four columns. */
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

  for (const task of tasks) {
    if (!activeProjectIds.has(task.project_id)) continue
    const dueDate = localDateOf(task.due_date)
    if (!dueDate) continue
    if (dueDate < today) {
      overdueTasks.push(task)
      continue
    }
    const dayTasks = byDate.get(dueDate)
    if (dayTasks) dayTasks.push(task)
  }

  return [{ date: null, tasks: overdueTasks }, ...days]
}
