/**
 * The task order of a project (docs/cross-app-semantics-v1.md section 12): how the tasks of the
 * project screen, its sections and the Inbox are ordered. Today, Upcoming, Anytime and custom
 * lists keep their own order. Android has the same rules; both run the `taskOrder` vectors of
 * `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Import-free on purpose, so every tsconfig can include it.
 */

export const TASK_ORDER_KEYS = [
  'due_date_first',
  'due_date_priority',
  'manual',
  'priority',
  'title',
  'newest',
  'oldest',
] as const

export type TaskOrderKey = (typeof TASK_ORDER_KEYS)[number]

export const DEFAULT_TASK_ORDER: TaskOrderKey = 'due_date_first'

/** The names shown in Settings and the project menu. */
export const TASK_ORDER_LABELS: Record<TaskOrderKey, string> = {
  due_date_first: 'Due date, then manual',
  due_date_priority: 'Due date, then priority',
  manual: 'Manual',
  priority: 'Priority',
  title: 'Title',
  newest: 'Newest first',
  oldest: 'Oldest first',
}

export function isTaskOrderKey(value: unknown): value is TaskOrderKey {
  return typeof value === 'string' && (TASK_ORDER_KEYS as readonly string[]).includes(value)
}

/** A stored order; anything this version does not know (a newer order, a wrong type) acts as the default. */
export function parseTaskOrder(value: unknown): TaskOrderKey {
  return isTaskOrderKey(value) ? value : DEFAULT_TASK_ORDER
}

/** The synced-preferences key of a project's own order (section 11.3). */
export function projectTaskOrderKey(projectId: number): string {
  return `task_order.project.${projectId}`
}

export const GLOBAL_TASK_ORDER_KEY = 'task_order'

// --- Comparing tasks (section 12.2) ---------------------------------------------------------

/** The fields the orders read. */
export interface OrderableTask {
  id: number
  title?: string | null
  due_date?: string | null
  priority?: number | null
  position?: number | null
  created?: string | null
}

const NULL_DATE = '0001-01-01T00:00:00Z'
const NULL_DATE_MS = Date.parse(NULL_DATE)

/** The instant of a date string, or null when it is missing, unreadable or the null date. */
function instant(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value === '' || value === NULL_DATE) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) && ms !== NULL_DATE_MS ? ms : null
}

/** True when the task has a due date that is not the null date. */
export function isDatedTask(task: Pick<OrderableTask, 'due_date'>): boolean {
  return instant(task.due_date) !== null
}

const priorityOf = (task: OrderableTask): number =>
  typeof task.priority === 'number' && Number.isFinite(task.priority) ? task.priority : 0

const positionOf = (task: OrderableTask): number =>
  typeof task.position === 'number' && Number.isFinite(task.position) ? task.position : 0

/** Lowercase without locale rules, compared by UTF-16 code units (plain `<`). */
function compareTitles(a: OrderableTask, b: OrderableTask): number {
  const left = (a.title ?? '').toLowerCase()
  const right = (b.title ?? '').toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** Dated first, then by due date; undated tasks compare equal here. */
function compareDue(a: OrderableTask, b: OrderableTask): number {
  const left = instant(a.due_date)
  const right = instant(b.due_date)
  if (left === null || right === null) {
    if (left === right) return 0
    return left === null ? 1 : -1
  }
  return left - right
}

/** Higher priority first. */
const comparePriority = (a: OrderableTask, b: OrderableTask): number => priorityOf(b) - priorityOf(a)

/** Created dates; a missing or unreadable one comes last in both directions. */
function compareCreated(a: OrderableTask, b: OrderableTask, newestFirst: boolean): number {
  const left = instant(a.created)
  const right = instant(b.created)
  if (left === null || right === null) {
    if (left === right) return 0
    return left === null ? 1 : -1
  }
  return newestFirst ? right - left : left - right
}

/** Every order ends here, so equal rows land in the same place on every device. */
const compareTie = (a: OrderableTask, b: OrderableTask): number => positionOf(a) - positionOf(b) || a.id - b.id

/** The comparison of one order; an unknown order is the default one. */
export function compareTasksByOrder(order: unknown, a: OrderableTask, b: OrderableTask): number {
  switch (parseTaskOrder(order)) {
    case 'due_date_first':
      return compareDue(a, b) || compareTie(a, b)
    case 'due_date_priority':
      return compareDue(a, b) || comparePriority(a, b) || compareTie(a, b)
    case 'manual':
      return compareTie(a, b)
    case 'priority':
      return comparePriority(a, b) || compareDue(a, b) || compareTie(a, b)
    case 'title':
      return compareTitles(a, b) || compareTie(a, b)
    case 'newest':
      return compareCreated(a, b, true) || compareTie(a, b)
    case 'oldest':
      return compareCreated(a, b, false) || compareTie(a, b)
  }
}

/** A sorted copy. */
export function sortTasksByOrder<T extends OrderableTask>(tasks: readonly T[], order: unknown): T[] {
  return [...tasks].sort((a, b) => compareTasksByOrder(order, a, b))
}

// --- Which order a project uses (section 12.3) ----------------------------------------------

/**
 * The order of `projectId`: its own entry, else its nearest ancestor's (a cycle ends the walk),
 * else the global `task_order`, else the default. `values` maps synced-preference keys to their
 * values; a `null` value is no entry, any other value is one (an unknown one acts as the default).
 * `parentOf` answers the parent project id, 0 or nothing for a top-level project.
 */
export function resolveTaskOrder(
  projectId: number,
  parentOf: (id: number) => number | null | undefined,
  values: Readonly<Record<string, unknown>>,
): TaskOrderKey {
  const seen = new Set<number>()
  let id: number | null | undefined = projectId
  while (typeof id === 'number' && id > 0 && !seen.has(id)) {
    seen.add(id)
    const entry = values[projectTaskOrderKey(id)]
    if (entry !== undefined && entry !== null) return parseTaskOrder(entry)
    id = parentOf(id)
  }
  return parseTaskOrder(values[GLOBAL_TASK_ORDER_KEY])
}

// --- Dragging (section 12.4) ----------------------------------------------------------------

/**
 * Whether a row can be dragged to a new place in its list: every row in `manual`, only undated rows
 * (among themselves) in `due_date_first`, none in the other orders. Move up and Move down follow it.
 */
export function canReorderTask(order: unknown, task: Pick<OrderableTask, 'due_date'>): boolean {
  const key = parseTaskOrder(order)
  if (key === 'manual') return true
  if (key === 'due_date_first') return !isDatedTask(task)
  return false
}

/** True when the order lets some rows be dragged at all. */
export function orderAllowsReorder(order: unknown): boolean {
  const key = parseTaskOrder(order)
  return key === 'manual' || key === 'due_date_first'
}
