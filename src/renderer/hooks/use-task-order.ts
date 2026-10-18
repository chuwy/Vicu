import { useCallback, useMemo } from 'react'
import { useProjects } from './use-projects'
import { useSetSyncedPreference, useSyncedPrefs } from './use-synced-prefs'
import {
  GLOBAL_TASK_ORDER_KEY,
  parseTaskOrder,
  projectTaskOrderKey,
  resolveTaskOrder,
  type TaskOrderKey,
} from '../../shared/task-order'

/**
 * The task order (cross-app semantics section 12): which order a project's list uses, from the
 * synced preferences (its own entry, else its nearest ancestor's, else the global one). Used by the
 * project screen, its sections and the Inbox; Today, Upcoming, Anytime and custom lists keep theirs.
 */
export function useTaskOrderResolver(): (projectId: number | undefined) => TaskOrderKey {
  const { snapshot } = useSyncedPrefs()
  const { data } = useProjects()
  const values = snapshot.values
  const parents = useMemo(() => {
    const map = new Map<number, number>()
    for (const project of data?.all ?? []) map.set(project.id, project.parent_project_id ?? 0)
    return map
  }, [data?.all])
  return useCallback(
    (projectId: number | undefined) => (projectId
      ? resolveTaskOrder(projectId, (id) => parents.get(id), values)
      : parseTaskOrder(values[GLOBAL_TASK_ORDER_KEY])),
    [parents, values],
  )
}

/** The order of one project's list (the Inbox: the Inbox project's). */
export function useTaskOrder(projectId: number | undefined): TaskOrderKey {
  return useTaskOrderResolver()(projectId)
}

const PROJECT_KEY_PREFIX = 'task_order.project.'
const PROJECT_KEY = /^task_order\.project\.[1-9]\d*$/

/** The global order, and a project's own entry (null: "Default", it follows its parent). */
export function useTaskOrderSettings(projectId?: number) {
  const { snapshot } = useSyncedPrefs()
  const set = useSetSyncedPreference()
  const own = projectId ? snapshot.values[projectTaskOrderKey(projectId)] : undefined
  // Every project entry that is set (null is "Default"); deleted projects included, so a reset clears them too.
  const projectKeys = Object.keys(snapshot.values)
    .filter((key) => PROJECT_KEY.test(key) && snapshot.values[key] !== null && snapshot.values[key] !== undefined)
  return {
    global: parseTaskOrder(snapshot.values[GLOBAL_TASK_ORDER_KEY]),
    /** The ids of the projects that have their own order. */
    projectsWithOwnOrder: projectKeys.map((key) => Number(key.slice(PROJECT_KEY_PREFIX.length))),
    /** Every project back to "Default": they follow their parent or the global order again, on every device. */
    resetProjects: () => {
      for (const key of projectKeys) set.mutate({ key, value: null })
    },
    /** The project's own choice, or null when it follows its parent or the global order. */
    projectOwn: own === undefined || own === null ? null : parseTaskOrder(own),
    setGlobal: (order: TaskOrderKey) => set.mutate({ key: GLOBAL_TASK_ORDER_KEY, value: order }),
    /** `null` is "Default": the entry is reset and the project follows its parent again. */
    setProject: (order: TaskOrderKey | null) => {
      if (projectId) set.mutate({ key: projectTaskOrderKey(projectId), value: order })
    },
  }
}
