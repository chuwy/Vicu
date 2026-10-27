/**
 * Suggestions in guided sessions (docs/ai-assistant-v1.md section 9): the request's user message
 * and batches (9.1), and the checks every answer goes through (9.3). Pinned by `organize.checks` in
 * test-fixtures/ai-tools-v1.json; Vicu mobile implements the same rules (`OrganizeChecks.kt`).
 *
 * Times are local wall-clock strings (`YYYY-MM-DDTHH:mm:ss`), as in dictation. The quick-add parser
 * that reads `when.said` lives in the renderer and comes in through the context (`readSaid`).
 */
import { AI_LIMITS } from './contract'
import { readWhen, type CheckContext, type WhenAnswer } from './dictation'

/** What a guided session asks suggestions for (9.1). */
export type OrganizeSession = 'inbox' | 'overdue' | 'waiting' | 'review'

// --- The request (9.1) ---------------------------------------------------------------------

/** At most `max` characters, cut at the last space at or before `max` (without one, at `max`). */
export function cutAtSpace(text: string, max: number): string {
  if (text.length <= max) return text
  const space = text.lastIndexOf(' ', max)
  return space < 0 ? text.slice(0, max) : text.slice(0, space)
}

/** A task's notes as sent: plain text, at most `organize_notes_max_chars`, cut at a space with `…` added. */
export function organizeNotes(plainText: string): string {
  const max = AI_LIMITS.organize_notes_max_chars
  if (plainText.length <= max) return plainText
  return `${cutAtSpace(plainText, max).trimEnd()}…`
}

/**
 * One task of the `<tasks>` block: its summary (5.2, any object with its keys in their order)
 * followed by `created` and `changed` (local dates or null) and `notes`.
 */
export function organizeTaskEntry<S extends object>(
  summary: S,
  extra: { created: string | null; changed: string | null; notes: string },
): S & { created: string | null; changed: string | null; notes: string } {
  return { ...summary, created: extra.created, changed: extra.changed, notes: organizeNotes(extra.notes) }
}

/** The one user message: the `<context>` block, `<session>`, then `<tasks>` with the JSON array. */
export function organizeUserMessage(contextJson: string, session: OrganizeSession, tasks: readonly object[]): string {
  return [
    `<context>\n${contextJson}\n</context>`,
    `<session>\n${session}\n</session>`,
    `<tasks>\n${JSON.stringify(tasks)}\n</tasks>`,
  ].join('\n')
}

/** The queue in batches of at most `organize_batch_max`, in queue order. */
export function organizeBatches<T>(queue: readonly T[]): T[][] {
  const size = AI_LIMITS.organize_batch_max
  const batches: T[][] = []
  for (let i = 0; i < queue.length; i += size) batches.push(queue.slice(i, i + size))
  return batches
}

/**
 * Whether the batch after the one ending at `batchEnd` (the index after its last card) should be
 * asked for now that the person is on card `index`: `organize_prefetch` cards from its end.
 */
export function shouldPrefetch(index: number, batchEnd: number): boolean {
  return index >= batchEnd - AI_LIMITS.organize_prefetch
}

// --- The answer (9.2) and its checks (9.3) -----------------------------------------------------

export interface SuggestionAnswer {
  task_id: unknown
  title: unknown
  project_id: unknown
  when: WhenAnswer | null
  clear_due: unknown
  close: unknown
  reason: unknown
}

export interface OrganizeAnswer {
  suggestions: SuggestionAnswer[]
  next_step: { task_id: unknown; title: unknown; when: WhenAnswer | null } | null
}

/** A task of the batch, as far as the checks need it. */
export interface OrganizeTask {
  id: number
  title: string
  project_id: number
  has_due: boolean
}

/** A suggestion after the checks. */
export interface Suggestion {
  task_id: number
  title: string | null
  project_id: number | null
  /** Local `YYYY-MM-DDTHH:mm:ss`; a date-only due date is 23:59:59 with `due_has_time` false. */
  due: string | null
  due_has_time: boolean
  clear_due: boolean
  close: 'done' | 'delete' | null
  reason: string
}

/** A review's next step: an open task of the batch, or a new task's title. */
export interface NextStep {
  task_id: number | null
  title: string | null
  due: string | null
  due_has_time: boolean
}

export interface OrganizeDropped {
  /** Null for the next step's date. */
  task_id: number | null
  field: 'task_id' | 'project' | 'when' | 'suggestion'
  value: unknown
}

export interface OrganizeResult {
  suggestions: Suggestion[]
  next_step: NextStep | null
  dropped: OrganizeDropped[]
}

const lineBreaks = /[\r\n]+/g

const oneLine = (text: string): string => text.replace(lineBreaks, ' ').trim()

/** A title: one line, trimmed, at most the title limit; null when empty. */
function checkedTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const title = cutAtSpace(oneLine(raw), AI_LIMITS.title_max_chars)
  return title === '' ? null : title
}

const wholeNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)

const hasTime = (due: string | null): boolean => due !== null && !due.endsWith('T23:59:59')

/** It sets nothing: the model says to leave the task as it is. */
export function leavesTaskAsIs(s: Pick<Suggestion, 'title' | 'project_id' | 'due' | 'clear_due' | 'close'>): boolean {
  return s.title === null && s.project_id === null && s.due === null && !s.clear_due && s.close === null
}

/** Runs the checks of 9.3. `ctx` is dictation's check context of the request (4.1). */
export function checkOrganizeAnswer(
  answer: OrganizeAnswer,
  session: OrganizeSession,
  tasks: readonly OrganizeTask[],
  ctx: Pick<CheckContext, 'reference' | 'projects' | 'readSaid'>,
): OrganizeResult {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const projectIds = new Set(ctx.projects.map((project) => project.id))
  const dropped: OrganizeDropped[] = []
  const seen = new Set<number>()
  const suggestions: Suggestion[] = []

  for (const s of Array.isArray(answer.suggestions) ? answer.suggestions : []) {
    if (typeof s !== 'object' || s === null) continue
    // 1. Task: one of the batch, once.
    const id = wholeNumber(s.task_id)
    const task = id !== null ? byId.get(id) : undefined
    if (!task || seen.has(task.id)) {
      dropped.push({ task_id: id, field: 'task_id', value: s.task_id ?? null })
      continue
    }
    seen.add(task.id)
    // 2. Title.
    const title = checkedTitle(s.title)
    // 3. Project.
    let projectId = wholeNumber(s.project_id)
    if (projectId !== null && !projectIds.has(projectId)) {
      dropped.push({ task_id: task.id, field: 'project', value: s.project_id })
      projectId = null
    }
    if (projectId === task.project_id) projectId = null
    // 4. When.
    const when = readWhen(s.when, ctx.reference, ctx.readSaid)
    if (when.dropped !== undefined) dropped.push({ task_id: task.id, field: 'when', value: when.dropped })
    // 5. Close.
    const close = s.close === 'done' || s.close === 'delete' ? s.close : null
    // 6. Reason.
    const reason = cutAtSpace(oneLine(typeof s.reason === 'string' ? s.reason : ''), AI_LIMITS.organize_reason_max_chars)
    const suggestion: Suggestion = {
      task_id: task.id,
      title: title === task.title ? null : title,
      project_id: projectId,
      due: when.due,
      due_has_time: hasTime(when.due),
      clear_due: when.due === null && task.has_due && s.clear_due === true,
      close,
      reason,
    }
    // 7. Nothing: kept only with a reason, which then says to leave the task.
    if (leavesTaskAsIs(suggestion) && reason === '') {
      dropped.push({ task_id: task.id, field: 'suggestion', value: task.id })
      continue
    }
    suggestions.push(suggestion)
  }

  return { suggestions, next_step: checkNextStep(answer.next_step, session, byId, ctx, dropped), dropped }
}

/** 8. Next step: only in a review; a task of the batch, else a new task's title. */
function checkNextStep(
  raw: OrganizeAnswer['next_step'],
  session: OrganizeSession,
  byId: ReadonlyMap<number, OrganizeTask>,
  ctx: Pick<CheckContext, 'reference' | 'readSaid'>,
  dropped: OrganizeDropped[],
): NextStep | null {
  if (session !== 'review' || typeof raw !== 'object' || raw === null) return null
  const id = wholeNumber(raw.task_id)
  const taskId = id !== null && byId.has(id) ? id : null
  const title = taskId === null ? checkedTitle(raw.title) : null
  if (taskId === null && title === null) return null
  const when = readWhen(raw.when, ctx.reference, ctx.readSaid)
  if (when.dropped !== undefined) dropped.push({ task_id: null, field: 'when', value: when.dropped })
  return { task_id: taskId, title, due: when.due, due_has_time: hasTime(when.due) }
}
