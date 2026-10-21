import { parse, type ParseResult, type ParserConfig } from '../task-parser'
import { resolveComposerFields } from '../composer-fields'
import { isDateOnly } from '../due-dates'
import { formatDateDisplay, type DateFormat } from '../date-display'
import type { CreateTaskPayload, TaskReminder } from '../vikunja-types'

// One spoken sentence as a new task, read like quick add (docs/voice-input.md): the quick-add
// parser with the user's settings and the composer's field rules with nothing picked by hand, the
// project the text names or else the Inbox, the labels it names, and the default reminder for a
// due date. The same rules as Android's TextTaskCreator. Pure: the caller creates the task.

export interface VoiceTaskContext {
  parserConfig: ParserConfig
  projects: readonly { id: number; title: string }[]
  inboxProjectId: number
  /** Settings, Notifications, Default reminder: 0 none, -1 at the due time, else seconds before. */
  reminderOffset?: number
  reminderRelativeTo?: TaskReminder['relative_to']
  now?: Date
}

export type VoiceTaskDraft =
  | {
      ok: true
      title: string
      projectId: number
      /** The project's name when it is not the Inbox (for the confirmation). */
      projectTitle: string | null
      payload: CreateTaskPayload
      labelNames: string[]
      parsed: ParseResult
    }
  | { ok: false; reason: 'empty' | 'no-inbox'; message: string }

/** The reminder the "Default reminder" setting adds to a task with a due date, or null. */
export function defaultReminder(
  dueDate: string | null | undefined,
  offsetSeconds: number | undefined,
  relativeTo: TaskReminder['relative_to'] = 'due_date',
): TaskReminder | null {
  if (!dueDate || !offsetSeconds) return null
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return null
  if (offsetSeconds === -1) return { reminder: due.toISOString(), relative_period: 0, relative_to: relativeTo }
  if (offsetSeconds < 0) return null
  return {
    reminder: new Date(due.getTime() - offsetSeconds * 1000).toISOString(),
    relative_period: -offsetSeconds,
    relative_to: relativeTo,
  }
}

/** Speech recognizers end a sentence with a full stop or capitalise oddly; quick add does not expect either. */
export function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').trim()
}

export function voiceTaskDraft(text: string, ctx: VoiceTaskContext): VoiceTaskDraft {
  const input = cleanTranscript(text)
  if (!input) return { ok: false, reason: 'empty', message: 'Nothing was heard.' }
  if (!ctx.inboxProjectId) return { ok: false, reason: 'no-inbox', message: 'Choose an Inbox in Settings first.' }

  // parse() also applies the `!` today shortcut when the parser is off.
  const parsed = parse(input, ctx.parserConfig, ctx.now ?? new Date())
  const fields = resolveComposerFields({
    parsed,
    dueTouched: false,
    dueValue: null,
    contextDue: null,
    contextDueDismissed: false,
    priority: null,
    projectTouched: false,
    selectedProjectId: ctx.inboxProjectId,
    findProjectId: (title) => ctx.projects.find((project) => project.title.toLowerCase() === title.toLowerCase())?.id,
    recurrenceTouched: false,
    repeatAfter: 0,
    repeatMode: 0,
  })
  const title = parsed.title.trim()
  if (!title) return { ok: false, reason: 'empty', message: 'Say what the task is.' }

  const payload: CreateTaskPayload = { title }
  if (fields.dueDate) payload.due_date = fields.dueDate
  if (fields.priority > 0) payload.priority = fields.priority
  if (fields.repeat) Object.assign(payload, fields.repeat)
  const reminder = defaultReminder(fields.dueDate, ctx.reminderOffset, ctx.reminderRelativeTo)
  if (reminder) payload.reminders = [reminder]

  const projectTitle = fields.projectId === ctx.inboxProjectId
    ? null
    : ctx.projects.find((project) => project.id === fields.projectId)?.title ?? null
  return {
    ok: true,
    title,
    projectId: fields.projectId,
    projectTitle,
    payload,
    labelNames: [...new Set(parsed.labels)],
    parsed,
  }
}

/**
 * The toast after a voice add: `Added “Call mom”, tomorrow, 15:00` or `Added “Report” to Work`.
 * The date is the row's phrase (date-display.ts), with Today and Tomorrow in lower case.
 */
export function voiceConfirmation(
  draft: { title: string; projectTitle: string | null; payload: Pick<CreateTaskPayload, 'due_date'> },
  now: Date,
  fmt: DateFormat,
): string {
  let text = `Added “${draft.title}”`
  if (draft.projectTitle) text += ` to ${draft.projectTitle}`
  const due = draft.payload.due_date
  if (due) {
    const phrase = formatDateDisplay('row', new Date(due), now, isDateOnly(due), fmt)
    if (phrase) text += `, ${/^(Today|Tomorrow)\b/.test(phrase) ? phrase[0].toLowerCase() + phrase.slice(1) : phrase}`
  }
  return text
}
