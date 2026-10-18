import type { Task } from './vikunja-types'
import { compareTasksByOrder } from '../../shared/task-order'

/**
 * The default task order, "Due date, then manual" (cross-app semantics 12.2): dated tasks first by
 * due date, then the undated ones by position, ties by position and then id. The project and
 * section caches are kept in it; the lists re-sort with the project's own order on display
 * (`sortTasksByOrder`, `useTaskOrder`).
 */
export function compareProjectTasks(a: Task, b: Task): number {
  return compareTasksByOrder('due_date_first', a, b)
}

export function sortProjectTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareProjectTasks)
}
