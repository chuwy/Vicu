/**
 * A guided session's suggestion request (docs/ai-assistant-v1.md section 9.1) from the window's
 * workspace: the context block of 4.1 for the session, the task entries (the summary of 5.2 with
 * `created`, `changed` and the start of the notes), and the checks the answer goes through (9.3).
 * Pure apart from the time zone name.
 */
import {
  checkOrganizeAnswer,
  organizeTaskEntry,
  organizeUserMessage,
  type OrganizeAnswer,
  type OrganizeResult,
  type OrganizeSession,
} from '../../../shared/ai/organize'
import { localDateOf } from '../../../shared/due-dates'
import type { Task } from '../vikunja-types'
import { readSaid } from './said-parser'
import { notesPlainText, summariseTask } from './task-summary'
import { contextProjects, dictationContextFor, type AiWorkspace } from './workspace'

export interface OrganizeRequestInput {
  session: OrganizeSession
  /** `Inbox`, `Overdue`, `Waiting`, or the reviewed project's path. */
  listName: string
  /** The Inbox, or the reviewed project. */
  defaultProjectId: number
  tasks: readonly Task[]
  /** Local `YYYY-MM-DDTHH:mm:ss`, when the request is made. */
  reference: string
}

const localDateOrNull = (value: string | null | undefined): string | null => localDateOf(value) || null

/** The one user message of the request. */
export function organizeRequestUser(ws: AiWorkspace, input: OrganizeRequestInput): string {
  const contextJson = dictationContextFor(ws, { name: input.listName, projectId: input.defaultProjectId, defaultDue: null }, input.reference)
  const entries = input.tasks.map((task) => organizeTaskEntry(summariseTask(task, ws), {
    created: localDateOrNull(task.created),
    changed: localDateOrNull(task.updated),
    notes: notesPlainText(task.description),
  }))
  return organizeUserMessage(contextJson, input.session, entries)
}

/** The checks of 9.3 on the answer, with the quick-add parser reading `when.said` at the reference. */
export function checkOrganize(ws: AiWorkspace, input: OrganizeRequestInput, answer: unknown, locale?: string): OrganizeResult {
  return checkOrganizeAnswer(
    answer as OrganizeAnswer,
    input.session,
    input.tasks.map((task) => ({ id: task.id, title: task.title, project_id: task.project_id, has_due: localDateOf(task.due_date) !== '' })),
    {
      reference: input.reference,
      projects: contextProjects(ws),
      readSaid: (said) => readSaid(said, input.reference, locale),
    },
  )
}
