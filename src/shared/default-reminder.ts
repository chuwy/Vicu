// The default reminder (Settings, Notifications, Default reminder): the reminder a new task gets
// when it is created with a due date and the user picked no reminder of their own. One rule for
// every place that creates a task (the composer, pasted lines, Quick Entry, standalone uploads,
// voice), the same as Android's DefaultReminder.build. Only on create: changing the date of an
// existing task never adds it. Pure: no Electron, no DOM.
//
// The offset is in seconds: 0 is off, -1 is "at the due time", a positive number is that long
// before. The reminder is relative (`relative_period` = minus the offset, `relative_to` from the
// setting), with the absolute time worked out from the stored due date. A date-only due date is
// stored as local 23:59:59, so "1 hour before" it is 22:59:59 that day (cross-app semantics 1).

const NULL_DATE = '0001-01-01T00:00:00Z'

export type ReminderRelativeTo = 'due_date' | 'start_date' | 'end_date'

export interface DefaultReminder {
  reminder: string
  relative_period: number
  relative_to: ReminderRelativeTo
}

/** The two settings, as `AppConfig` holds them. */
export interface DefaultReminderSettings {
  notifications_default_reminder_offset?: number
  notifications_default_reminder_relative_to?: ReminderRelativeTo
}

/** The reminder to add to a new task with this due date, or null (setting off, no due date). */
export function buildDefaultReminder(
  dueDate: string | null | undefined,
  offsetSeconds: number | null | undefined,
  relativeTo: ReminderRelativeTo = 'due_date',
): DefaultReminder | null {
  if (!offsetSeconds || !Number.isFinite(offsetSeconds)) return null
  if (!dueDate || dueDate === NULL_DATE) return null
  if (offsetSeconds === -1) return { reminder: dueDate, relative_period: 0, relative_to: relativeTo }
  const due = Date.parse(dueDate)
  if (Number.isNaN(due)) return null
  return {
    reminder: new Date(due - offsetSeconds * 1000).toISOString(),
    relative_period: -offsetSeconds,
    relative_to: relativeTo,
  }
}

/**
 * The create payload with the default reminder added, when it has a due date and no reminders of
 * its own; otherwise the payload as it was (reminders the user picked always win).
 */
export function withDefaultReminder<T extends object>(
  payload: T,
  settings: DefaultReminderSettings | null | undefined,
): T & { reminders?: unknown } {
  if (!settings) return payload
  const fields = payload as { due_date?: unknown; reminders?: unknown }
  if (Array.isArray(fields.reminders) && fields.reminders.length > 0) return payload
  const reminder = buildDefaultReminder(
    typeof fields.due_date === 'string' ? fields.due_date : null,
    settings.notifications_default_reminder_offset,
    settings.notifications_default_reminder_relative_to ?? 'due_date',
  )
  return reminder ? { ...payload, reminders: [reminder] } : payload
}
