import { describe, expect, it } from 'vitest'
import { addLocalDays, dateOnlyDue, startOfLocalDayIso, toLocalDate } from '@/lib/due-dates'
import { groupPlannerTasks, plannerDueDateOnDrop, plannerTaskFilter, plannerTaskSortKey, PLANNER_DAY_COUNT } from '@/lib/planner'
import type { Task } from '@/lib/vikunja-types'

function task(id: number, dueDate: string, projectId = 1): Task {
  return { id, due_date: dueDate, project_id: projectId } as Task
}

describe('Planner', () => {
  it('asks the server for every task in the overdue range and the three dated days on screen', () => {
    const now = new Date(2026, 4, 31, 12)

    expect(plannerTaskFilter(now)).toBe(
      `due_date != '0001-01-01T00:00:00Z' && due_date < '${startOfLocalDayIso(PLANNER_DAY_COUNT, now)}'`,
    )
  })

  it('groups overdue tasks before today and the next two local calendar days', () => {
    const now = new Date(2026, 4, 31, 12)
    const today = toLocalDate(now)
    const tomorrow = addLocalDays(today, 1)
    const thirdDay = addLocalDays(today, 2)
    const tasks = [
      task(1, dateOnlyDue(today)),
      task(2, dateOnlyDue(tomorrow)),
      task(3, new Date(2026, 5, 2, 9, 30).toISOString()),
      task(4, dateOnlyDue(addLocalDays(today, -1))),
      task(5, dateOnlyDue(addLocalDays(today, PLANNER_DAY_COUNT))),
      task(6, '0001-01-01T00:00:00Z'),
    ]

    const days = groupPlannerTasks(tasks, new Set([1]), now)

    expect(days.map((day) => day.date)).toEqual([null, '2026-05-31', '2026-06-01', '2026-06-02'])
    expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[4], [1], [2], [3]])
  })

  it('keeps completed tasks in dated columns without sorting them separately, but not in overdue', () => {
    const now = new Date(2026, 4, 31, 12)
    const today = toLocalDate(now)
    const tasks = [
      { ...task(1, dateOnlyDue(addLocalDays(today, -1))), done: true },
      task(2, new Date(2026, 4, 31, 12).toISOString()),
      { ...task(3, new Date(2026, 4, 31, 10).toISOString()), done: true },
      task(4, new Date(2026, 4, 31, 14).toISOString()),
    ]

    const days = groupPlannerTasks(tasks, new Set([1]), now)

    expect(days[0].tasks).toEqual([])
    expect(days[1].tasks.map((item) => item.id)).toEqual([3, 2, 4])
    expect(days[1].tasks[0].done).toBe(true)
  })

  it('uses start_date first, then due minus duration, with end_date ignored', () => {
    const due = new Date(2026, 5, 1, 15, 0).toISOString()
    const start = new Date(2026, 5, 1, 9, 30).toISOString()
    const end = new Date(2026, 5, 1, 1, 0).toISOString()

    expect(plannerTaskSortKey({
      ...task(1, due),
      start_date: start,
      end_date: end,
      description: '<!-- vicu-duration:v1:120 -->',
    })).toBe(Date.parse(start))
    expect(plannerTaskSortKey({ ...task(2, due), end_date: end, description: '<!-- vicu-duration:v1:120 -->' }))
      .toBe(Date.parse(due) - 120 * 60_000)
    expect(plannerTaskSortKey(task(3, due))).toBe(Date.parse(due))
    expect(plannerTaskSortKey({ ...task(4, due), start_date: '0001-01-01T00:00:00Z' })).toBe(Date.parse(due))
  })

  it('orders every day column by the effective Planner key', () => {
    const now = new Date(2026, 4, 31, 12)
    const today = toLocalDate(now)
    const at = (hour: number) => new Date(2026, 5, 1, hour, 0).toISOString()
    const tasks = [
      task(1, at(12)),
      { ...task(2, at(13)), description: '<!-- vicu-duration:v1:120 -->' },
      { ...task(3, at(10)), description: '<!-- vicu-duration:v1:0 -->' },
      { ...task(4, at(9)), start_date: at(14), description: '<!-- vicu-duration:v1:300 -->' },
      task(5, dateOnlyDue(addLocalDays(today, 1))),
    ]

    const days = groupPlannerTasks(tasks, new Set([1]), now)

    expect(days[2].tasks.map((item) => item.id)).toEqual([3, 2, 1, 4, 5])
  })

  it('changes the date of a dropped task without changing its explicit local time', () => {
    const original = new Date(2026, 2, 7, 9, 30, 45, 123).toISOString()

    const result = plannerDueDateOnDrop(original, '2026-03-08')

    expect(result).toBe(new Date(2026, 2, 8, 9, 30, 45, 123).toISOString())
  })

  it('keeps date-only tasks date-only and ignores drops with no date change', () => {
    expect(plannerDueDateOnDrop(dateOnlyDue('2026-06-01'), '2026-06-03')).toBe(dateOnlyDue('2026-06-03'))
    expect(plannerDueDateOnDrop(dateOnlyDue('2026-06-01'), '2026-06-01')).toBeNull()
    expect(plannerDueDateOnDrop('0001-01-01T00:00:00Z', '2026-06-01')).toBeNull()
  })

  it('leaves archived-project tasks out and keeps empty day columns', () => {
    const now = new Date(2026, 0, 10, 12)
    const today = toLocalDate(now)
    const days = groupPlannerTasks(
      [task(1, dateOnlyDue(today), 9), task(2, dateOnlyDue(addLocalDays(today, 1)))],
      new Set([1]),
      now,
    )

    expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[], [], [2], []])
  })
})
