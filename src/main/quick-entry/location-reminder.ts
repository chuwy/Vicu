import {
  DEFAULT_LOCATION_RADIUS,
  isPlaceId,
  locationReminderKey,
  type LocationReminderPref,
} from '../../shared/synced-prefs'

/**
 * "When I get home" typed in Quick Entry (contract section 5.3): the location reminder to write for
 * the task the server just created, as `location_reminder.<taskId>` with the default radius. Null
 * when the window asked for none, the value is malformed, or the task has no server id yet (a create
 * queued offline: section 11.7 writes a key for a server id only).
 */
export function quickEntryLocationReminder(
  taskId: unknown,
  location: unknown,
): { key: string; value: LocationReminderPref } | null {
  if (typeof taskId !== 'number' || !Number.isInteger(taskId) || taskId <= 0) return null
  if (!location || typeof location !== 'object' || Array.isArray(location)) return null
  const { place, trigger } = location as Record<string, unknown>
  if (!isPlaceId(place) || (trigger !== 'arrive' && trigger !== 'leave')) return null
  return { key: locationReminderKey(taskId), value: { place, trigger, radius_m: DEFAULT_LOCATION_RADIUS } }
}
