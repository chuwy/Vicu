/**
 * The task summary Ask's read tools return (docs/ai-assistant-v1.md section 5.2, `ask.taskSummary`
 * in the fixture), and the plain text of a task's notes. Hidden tasks never get here: the tools
 * leave them out first (`isHiddenTask`). Pure.
 */
import { isHiddenTask } from '../../../shared/hidden-tasks'
import { displayName } from '../../../shared/collaboration'
import { isDateOnly, isNoDueDate } from '../../../shared/due-dates'
import { localDateTimeOf } from '../../../shared/ai/dictation'
import type { Task } from '../vikunja-types'
import { pathOf, type AiWorkspace } from './workspace'

export interface TaskSummary {
  id: number
  title: string
  done: boolean
  due: string | null
  project_id: number
  project: string
  labels: string[]
  priority: number
  repeats: boolean
  has_notes: boolean
  subtask_count: number
  shared: boolean
  by?: string
  assignees?: string[]
  comment_count?: number
  unread?: boolean
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** The text of a description (HTML), one line per paragraph or list item, without the markup. */
export function notesPlainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/blockquote|\/pre|\/div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      const lower = name.toLowerCase()
      if (ENTITIES[lower]) return ENTITIES[lower]
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
      return match
    })
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** `YYYY-MM-DD` for a date-only due date, `YYYY-MM-DDTHH:mm` with a time, or null (local). */
export function summaryDue(value: string | null | undefined): string | null {
  if (!value || isNoDueDate(value)) return null
  const local = localDateTimeOf(new Date(value))
  return isDateOnly(value) ? local.slice(0, 10) : local.slice(0, 16)
}

export function repeats(task: Pick<Task, 'repeat_after' | 'repeat_mode'>): boolean {
  return (task.repeat_after ?? 0) > 0 || task.repeat_mode === 1
}

export function isVisibleTask(task: Pick<Task, 'description'>): boolean {
  return !isHiddenTask(task.description)
}

export function summariseTask(task: Task, ws: AiWorkspace): TaskSummary {
  const access = ws.access(task.project_id)
  const me = ws.me?.id ?? null
  const summary: TaskSummary = {
    id: task.id,
    title: task.title,
    done: task.done === true,
    due: summaryDue(task.due_date),
    project_id: task.project_id,
    project: pathOf(ws, task.project_id),
    labels: (task.labels ?? []).map((label) => label.title),
    priority: typeof task.priority === 'number' ? task.priority : 0,
    repeats: repeats(task),
    has_notes: notesPlainText(task.description) !== '',
    subtask_count: task.related_tasks?.subtask?.length ?? 0,
    shared: access.shared,
  }
  if (access.shared) {
    const creator = task.created_by
    if (creator && me !== null && creator.id !== me) summary.by = displayName(creator)
    const assignees = task.assignees ?? []
    const mine = assignees.filter((person) => person.id === me)
    const others = assignees.filter((person) => person.id !== me)
    summary.assignees = [...mine.map(() => 'You'), ...others.map((person) => displayName(person))]
    summary.comment_count = task.comment_count ?? 0
    summary.unread = task.is_unread === true
  }
  return summary
}
