/**
 * Which routine reminders this account gets (docs/cross-app-semantics-v1.md section 6.9). Pure, so
 * the rules run in unit tests; `notifications.ts` feeds them the carriers, the synced preferences
 * and the projects.
 *
 * - A private routine is only ever the user's own: it reminds by its own settings.
 * - The owner of a shared routine is reminded by the routine's settings; nobody else's choice
 *   changes that.
 * - Another member is reminded unless they hid the routine or turned its reminders off for
 *   themselves (synced preferences `routine_hidden.<id>` / `routine_reminders.<id>`), and not at all
 *   when they can only view its project (permission 0): they could not tick it off.
 */
import { createdById } from '../shared/hidden-tasks'
import { isSharedRoutine, type RoutinePayload } from '../shared/routines'
import { routineHidden, routineRemindersOn } from '../shared/synced-prefs'

export interface RoutineReminderContext {
  /** The signed-in user, or null before it is known. */
  me: number | null
  /** The synced preferences' values (`getSyncedPrefs().values`). */
  prefs: Readonly<Record<string, unknown>>
  /** Your permission on a project (0 read only, 1 write, 2 admin), or null when unknown (counts as write). */
  permissionOf(projectId: number): number | null
}

export interface RoutineReminderCarrier {
  created_by?: { id?: unknown } | null
  project_id?: number
}

/** True when this account gets the reminders of the routine in `carrier`. */
export function routineRemindsHere(carrier: RoutineReminderCarrier, payload: RoutinePayload, context: RoutineReminderContext): boolean {
  if (!isSharedRoutine(payload)) return true
  const owner = createdById(carrier)
  if (owner !== null && owner === context.me) return true
  const routineId = payload.definition.id
  if (routineHidden(context.prefs, routineId) || !routineRemindersOn(context.prefs, routineId)) return false
  const permission = typeof carrier.project_id === 'number' ? context.permissionOf(carrier.project_id) : null
  return permission === null || permission >= 1
}

/** True while an occurrence still waits: not completed and not skipped (by anyone). */
export function occurrenceStillOpen(payload: RoutinePayload, occurrenceKey: string): boolean {
  const status = payload.occurrences[occurrenceKey]?.status
  return status !== 'COMPLETED' && status !== 'SKIPPED'
}
