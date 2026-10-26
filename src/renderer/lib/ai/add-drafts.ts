/**
 * Adding checked drafts (docs/ai-assistant-v1.md section 4.5) through the path quick add uses:
 * stored first and queued when the server cannot be reached, the default reminder when the draft
 * has none of its own, new labels created first, subtasks as task relations, a place as a location
 * reminder (semantics 11.7). Also the payload of one draft, shared with Ask's create proposals.
 * The writes are injected so this stays testable.
 */
import { dueForApi, type CheckedDraft } from '../../../shared/ai/dictation'
import { withDefaultReminder, type DefaultReminderSettings } from '../../../shared/default-reminder'
import { plainTextToDescriptionHtml, escapeHtml } from '../description-html'
import { recurrenceToVikunja } from '../task-parser'
import { isTempTaskId } from '../pending-cache'
import type { CreateTaskPayload, Label, Task } from '../vikunja-types'

export interface AddDraftsDeps {
  createTask(projectId: number, payload: CreateTaskPayload, labels: Label[]): Promise<Task>
  createLabel(title: string): Promise<Label>
  addLabel(task: Task, label: Label): Promise<void>
  createSubtaskRelation(parentId: number, childId: number): Promise<void>
  /** Changes a task's description (a queued create folds it in). */
  setDescription(task: Task, description: string): Promise<void>
  setLocationReminder(taskId: number, placeId: string, trigger: 'arrive' | 'leave'): void
  knownLabels: readonly Label[]
  defaultReminder: DefaultReminderSettings | null
}

export interface AddDraftsResult {
  /** Every task made, parents before their subtasks, in draft order. */
  created: Task[]
  /** The top-level tasks (one per draft). */
  tasks: Task[]
  problems: string[]
}

/** The create payload of a checked draft (without labels, which go on after the create). */
export function draftPayload(draft: CheckedDraft, defaultReminder: DefaultReminderSettings | null): CreateTaskPayload {
  let payload: CreateTaskPayload = { title: draft.title }
  if (draft.notes) payload.description = plainTextToDescriptionHtml(draft.notes)
  const due = draft.due ? dueForApi(draft.due) : null
  if (due) payload.due_date = due
  if (draft.priority) payload.priority = draft.priority
  if (draft.repeat) Object.assign(payload, recurrenceToVikunja({ interval: draft.repeat.every, unit: draft.repeat.unit }))
  if (draft.reminder) {
    if ('before_due_minutes' in draft.reminder) {
      if (due) {
        const seconds = draft.reminder.before_due_minutes * 60
        payload.reminders = [{ reminder: new Date(Date.parse(due) - seconds * 1000).toISOString(), relative_period: -seconds, relative_to: 'due_date' }]
      }
    } else {
      payload.reminders = [{ reminder: dueForApi(draft.reminder.at) }]
    }
  } else {
    payload = withDefaultReminder(payload, defaultReminder) as CreateTaskPayload
  }
  return payload
}

/** A TipTap task list of the steps (description-format-v1), for a parent that only exists offline. */
export function stepsAsTaskList(steps: readonly string[]): string {
  const items = steps.map((step) => `<li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p>${escapeHtml(step)}</p></div></li>`)
  return `<ul data-type="taskList">${items.join('')}</ul>`
}

export async function addDrafts(
  drafts: readonly CheckedDraft[],
  deps: AddDraftsDeps,
  options: { parent?: Task | null } = {},
): Promise<AddDraftsResult> {
  const created: Task[] = []
  const tasks: Task[] = []
  const problems: string[] = []

  // New labels first, once each.
  const labels = new Map<string, Label>(deps.knownLabels.map((label) => [label.title.toLowerCase(), label]))
  for (const draft of drafts) {
    for (const label of draft.labels) {
      if (labels.has(label.title.toLowerCase())) continue
      try {
        labels.set(label.title.toLowerCase(), await deps.createLabel(label.title))
      } catch {
        problems.push(`The label “${label.title}” could not be created.`)
      }
    }
  }

  for (const draft of drafts) {
    const payload = draftPayload(draft, deps.defaultReminder)
    const projectId = options.parent ? options.parent.project_id : draft.project_id
    const draftLabels = draft.labels.map((l) => labels.get(l.title.toLowerCase())).filter((l): l is Label => !!l)
    const task = await deps.createTask(projectId, payload, draftLabels)
    created.push(task)
    tasks.push(task)
    if (!isTempTaskId(task.id)) {
      for (const label of draftLabels) {
        try {
          await deps.addLabel(task, label)
        } catch {
          problems.push(`A label could not be added to “${task.title}”.`)
        }
      }
    }

    // Break into steps: each draft is a subtask of the task it came from.
    if (options.parent && !isTempTaskId(options.parent.id) && !isTempTaskId(task.id)) {
      try {
        await deps.createSubtaskRelation(options.parent.id, task.id)
      } catch {
        problems.push(`“${task.title}” could not be made a subtask.`)
      }
    }

    if (draft.subtasks.length > 0) {
      if (isTempTaskId(task.id)) {
        // The relation needs both tasks on the server; offline the steps become a checklist.
        try {
          await deps.setDescription(task, `${payload.description ?? ''}${stepsAsTaskList(draft.subtasks)}`)
        } catch {
          problems.push(`The steps of “${task.title}” could not be kept.`)
        }
      } else {
        for (const title of draft.subtasks) {
          try {
            const child = await deps.createTask(projectId, { title }, [])
            created.push(child)
            if (!isTempTaskId(child.id)) await deps.createSubtaskRelation(task.id, child.id)
          } catch {
            problems.push(`A subtask of “${task.title}” could not be added.`)
          }
        }
      }
    }

    if (draft.place) {
      if (isTempTaskId(task.id)) problems.push(`“${task.title}” was saved offline, so its place reminder was not set.`)
      else deps.setLocationReminder(task.id, draft.place.place_id, draft.place.trigger)
    }
  }
  return { created, tasks, problems }
}
