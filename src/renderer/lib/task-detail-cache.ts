import type { QueryClient } from '@tanstack/react-query'
import type { Task } from './vikunja-types'
import { mapTaskDoneByIds, removeTaskIdsFromTree } from './task-hierarchy'

type TaskDetailSnapshot = [readonly unknown[], Task[] | undefined][]

/** Keep fetched subtask arrays in sync with optimistic task completion changes. */
export function updateTaskDetailDone(
  qc: QueryClient,
  doneById: ReadonlyMap<number, boolean>,
) {
  const previous = qc.getQueriesData<Task[]>({ queryKey: ['task-detail'] })
  qc.setQueriesData<Task[]>({ queryKey: ['task-detail'] }, (old) =>
    old?.map((task) => mapTaskDoneByIds(task, doneById)),
  )
  return previous
}

/** Keep fetched subtask arrays in sync with an optimistic edit of one task (a renamed subtask). */
export function updateTaskDetailFields(
  qc: QueryClient,
  id: number,
  changes: Partial<Task>,
): TaskDetailSnapshot {
  const previous = qc.getQueriesData<Task[]>({ queryKey: ['task-detail'] })
  qc.setQueriesData<Task[]>({ queryKey: ['task-detail'] }, (old) =>
    old?.map((task) => (task.id === id ? { ...task, ...changes } : task)),
  )
  return previous
}

/** Take deleted tasks out of the fetched subtask arrays at once. */
export function removeFromTaskDetail(
  qc: QueryClient,
  ids: ReadonlySet<number>,
): TaskDetailSnapshot {
  const previous = qc.getQueriesData<Task[]>({ queryKey: ['task-detail'] })
  qc.setQueriesData<Task[]>({ queryKey: ['task-detail'] }, (old) =>
    old?.map((task) => removeTaskIdsFromTree(task, ids)).filter((task): task is Task => task !== null),
  )
  return previous
}

/** Put the fetched subtask arrays back after a failed change. */
export function restoreTaskDetail(qc: QueryClient, previous: TaskDetailSnapshot | undefined): void {
  for (const [key, data] of previous ?? []) qc.setQueryData(key, data)
}
