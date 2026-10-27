/**
 * The cards of a guided session (docs/cross-app-semantics-v1.md section 14.3): what a card holds
 * while the person decides, a model's suggestion laid on it (docs/ai-assistant-v1.md section 9.4),
 * the changes Next writes, what the session changed, its summary line and what Undo all puts back.
 * Pure: the views run the mutations.
 */
import { NULL_DATE } from '../constants'
import { isNoDueDate } from '../due-dates'
import { dueForApi } from '../../../shared/ai/dictation'
import type { NextStep, Suggestion } from '../../../shared/ai/organize'
import type { Task } from '../vikunja-types'

/** The choices on a card: the title, the project and the due date (an ISO date or the null date). */
export interface CardDraft {
  title: string
  projectId: number
  due: string
}

/** Which choices a suggestion filled in (drawn with the dashed outline). */
export type SuggestedField = 'title' | 'project' | 'when'

/** A due date as the card holds it: the null date for none. */
export const noDue = (value: string | null | undefined): string => (!value || isNoDueDate(value) ? NULL_DATE : value)

export function draftOf(task: Pick<Task, 'title' | 'project_id' | 'due_date'>): CardDraft {
  return { title: task.title, projectId: task.project_id, due: noDue(task.due_date) }
}

const sameDue = (a: string, b: string): boolean => {
  const left = noDue(a)
  const right = noDue(b)
  if (left === NULL_DATE || right === NULL_DATE) return left === right
  return Date.parse(left) === Date.parse(right)
}

/**
 * The fields Next writes: only what differs from the task as it is now. An empty title keeps the
 * task's own. Nothing differs: an empty object, and Next is a Skip.
 */
export function draftChanges(task: Pick<Task, 'title' | 'project_id' | 'due_date'>, draft: CardDraft): Partial<Task> {
  const changes: Partial<Task> = {}
  const title = draft.title.replace(/[\r\n]+/g, ' ').trim()
  if (title !== '' && title !== task.title) changes.title = title
  if (draft.projectId !== task.project_id) changes.project_id = draft.projectId
  if (!sameDue(draft.due, task.due_date)) changes.due_date = noDue(draft.due)
  return changes
}

/** The card with a checked suggestion laid on it, and which choices it filled in. */
export function withSuggestion(
  task: Pick<Task, 'title' | 'project_id' | 'due_date'>,
  suggestion: Suggestion | null | undefined,
): { draft: CardDraft; suggested: Set<SuggestedField> } {
  const draft = draftOf(task)
  const suggested = new Set<SuggestedField>()
  if (!suggestion) return { draft, suggested }
  if (suggestion.title !== null) {
    draft.title = suggestion.title
    suggested.add('title')
  }
  if (suggestion.project_id !== null) {
    draft.projectId = suggestion.project_id
    suggested.add('project')
  }
  if (suggestion.due !== null) {
    draft.due = dueForApi(suggestion.due)
    suggested.add('when')
  } else if (suggestion.clear_due) {
    draft.due = NULL_DATE
    suggested.add('when')
  }
  return { draft, suggested }
}

/** The due date a review's next step suggests (local wall-clock in the answer), as an ISO date. */
export function nextStepDue(step: Pick<NextStep, 'due'> | null | undefined): string | null {
  return step?.due ? dueForApi(step.due) : null
}

// --- What the session changed ----------------------------------------------------------------

type Fields = Pick<Task, 'title' | 'project_id' | 'due_date'>

export interface LogEntry {
  /** The task as it was before the session first changed it. */
  before: Task
  /** The fields as the session left them. */
  after: Fields
  completed: boolean
  deleted: boolean
}

/** Every task a session touched, by id, in the order first touched. */
export type SessionLog = ReadonlyMap<number, LogEntry>

const fieldsOf = (task: Fields): Fields => ({ title: task.title, project_id: task.project_id, due_date: noDue(task.due_date) })

function entryFor(log: SessionLog, task: Task): LogEntry {
  return log.get(task.id) ?? { before: task, after: fieldsOf(task), completed: false, deleted: false }
}

export function logChange(log: SessionLog, task: Task, changes: Partial<Task>): SessionLog {
  const entry = entryFor(log, task)
  const after = fieldsOf({ ...entry.after, ...pickFields(changes) })
  return new Map(log).set(task.id, { ...entry, after })
}

export function logComplete(log: SessionLog, task: Task): SessionLog {
  return new Map(log).set(task.id, { ...entryFor(log, task), completed: true })
}

export function logDelete(log: SessionLog, task: Task): SessionLog {
  return new Map(log).set(task.id, { ...entryFor(log, task), deleted: true })
}

function pickFields(changes: Partial<Task>): Partial<Fields> {
  const picked: Partial<Fields> = {}
  if (changes.title !== undefined) picked.title = changes.title
  if (changes.project_id !== undefined) picked.project_id = changes.project_id
  if (changes.due_date !== undefined) picked.due_date = changes.due_date
  return picked
}

export interface SessionCounts {
  sorted: number
  scheduled: number
  unscheduled: number
  moved: number
  renamed: number
  completed: number
  deleted: number
}

export function sessionCounts(log: SessionLog): SessionCounts {
  const counts: SessionCounts = { sorted: 0, scheduled: 0, unscheduled: 0, moved: 0, renamed: 0, completed: 0, deleted: 0 }
  for (const entry of log.values()) {
    if (entry.deleted) {
      counts.deleted++
      counts.sorted++
      continue
    }
    if (entry.completed) {
      counts.completed++
      counts.sorted++
      continue
    }
    const before = fieldsOf(entry.before)
    const dueChanged = !sameDue(before.due_date, entry.after.due_date)
    const moved = before.project_id !== entry.after.project_id
    const renamed = before.title !== entry.after.title
    if (dueChanged) {
      if (noDue(entry.after.due_date) === NULL_DATE) counts.unscheduled++
      else counts.scheduled++
    }
    if (moved) counts.moved++
    if (renamed) counts.renamed++
    if (dueChanged || moved || renamed) counts.sorted++
  }
  return counts
}

/** "Sorted 12: 5 scheduled, 4 moved, 2 completed, 1 deleted", or "Nothing changed". */
export function summaryText(counts: SessionCounts): string {
  if (counts.sorted === 0) return 'Nothing changed'
  const parts = [
    counts.scheduled > 0 && `${counts.scheduled} scheduled`,
    counts.unscheduled > 0 && `${counts.unscheduled} without a date now`,
    counts.moved > 0 && `${counts.moved} moved`,
    counts.renamed > 0 && `${counts.renamed} renamed`,
    counts.completed > 0 && `${counts.completed} completed`,
    counts.deleted > 0 && `${counts.deleted} deleted`,
  ].filter((part): part is string => typeof part === 'string')
  return `Sorted ${counts.sorted}: ${parts.join(', ')}`
}

/** One step of Undo all. */
export type UndoStep =
  | { type: 'reopen'; task: Task }
  | { type: 'patch'; id: number; changes: Partial<Task>; original: Task }

/**
 * What Undo all does: every change goes back except deletes. A completed task is reopened and its
 * fields put back as they were; an edited one gets its old fields in a patch against how the
 * session left it.
 */
export function undoPlan(log: SessionLog): UndoStep[] {
  const steps: UndoStep[] = []
  for (const entry of log.values()) {
    if (entry.deleted) continue
    const before = fieldsOf(entry.before)
    const current: Task = { ...entry.before, ...entry.after, done: entry.completed ? true : entry.before.done }
    if (entry.completed) steps.push({ type: 'reopen', task: current })
    const changes: Partial<Task> = {}
    if (before.title !== entry.after.title) changes.title = before.title
    if (before.project_id !== entry.after.project_id) changes.project_id = before.project_id
    if (!sameDue(before.due_date, entry.after.due_date)) changes.due_date = before.due_date
    if (Object.keys(changes).length > 0) steps.push({ type: 'patch', id: entry.before.id, changes, original: { ...current, done: false } })
  }
  return steps
}

/** True when Undo all has something to put back. */
export function canUndoAll(log: SessionLog): boolean {
  return undoPlan(log).length > 0
}
