import { useCallback, useMemo } from 'react'
import { useSetSyncedPreference, useSyncedPrefs } from './use-synced-prefs'
import {
  locationReminderKey,
  readLocationReminderPref,
  readSyncedPlaces,
  type LocationReminderPref,
  type LocationTrigger,
} from '../../shared/synced-prefs'

/** A task's location reminder with the name of its place. */
export interface TaskLocationReminder extends LocationReminderPref {
  placeName: string
}

/**
 * Saved places and location reminders (cross-app semantics section 11.7). Places are saved on a
 * phone, which alone knows where they are and reminds there; the desktop picks one for a task.
 * Only a task the server knows (an id above 0) can have one.
 */
export function useLocationReminders() {
  const { snapshot } = useSyncedPrefs()
  const set = useSetSyncedPreference()
  const values = snapshot.values
  const places = useMemo(() => readSyncedPlaces(values), [values])

  const reminderFor = useCallback((taskId: number | undefined): TaskLocationReminder | null => {
    if (!taskId || taskId <= 0) return null
    const reminder = readLocationReminderPref(values[locationReminderKey(taskId)])
    const place = reminder ? places.find((p) => p.id === reminder.place) : undefined
    return reminder && place ? { ...reminder, placeName: place.name } : null
  }, [values, places])

  const setReminder = useCallback((taskId: number, place: string, trigger: LocationTrigger, radius: number) => {
    if (taskId > 0) set.mutate({ key: locationReminderKey(taskId), value: { place, trigger, radius_m: radius } })
  }, [set])

  const removeReminder = useCallback((taskId: number) => {
    if (taskId > 0) set.mutate({ key: locationReminderKey(taskId), value: null })
  }, [set])

  return { places, reminderFor, setReminder, removeReminder }
}

/** Whether a task has a location reminder, for the row's bell (reads only). */
export function useHasLocationReminder(taskId: number): boolean {
  const { snapshot } = useSyncedPrefs()
  return taskId > 0 && readLocationReminderPref(snapshot.values[locationReminderKey(taskId)]) !== null
}
