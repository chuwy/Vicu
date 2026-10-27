import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Task } from '@/lib/vikunja-types'
import {
  mapTaskDoneByIds,
  removeTaskIdsFromTree,
  renamedSubtaskTitle,
  subtaskProgress,
  taskDescendants,
  unfinishedDescendants,
} from '../task-hierarchy'
import { resolveSelectedTasks } from '../task-selection'
import {
  removeFromTaskDetail,
  restoreTaskDetail,
  updateTaskDetailDone,
  updateTaskDetailFields,
} from '../task-detail-cache'

function task(id: number, done = false, children: Task[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    done,
    done_at: '0001-01-01T00:00:00Z',
    due_date: '0001-01-01T00:00:00Z',
    start_date: '0001-01-01T00:00:00Z',
    end_date: '0001-01-01T00:00:00Z',
    priority: 0,
    project_id: 1,
    labels: [],
    reminders: [],
    related_tasks: children.length > 0 ? { subtask: children } : {},
    created: '',
    updated: '',
    created_by: { id: 1, username: 'owner' },
    identifier: '',
    position: 0,
    bucket_id: 0,
    percent_done: 0,
    repeat_after: 0,
    repeat_mode: 0,
    hex_color: '',
  }
}

describe('task hierarchy', () => {
  it('walks every level and reports recursive progress', () => {
    const root = task(1, false, [task(2, true, [task(3)]), task(4)])

    expect(taskDescendants(root).map((item) => item.id)).toEqual([2, 3, 4])
    expect(unfinishedDescendants(root).map((item) => item.id)).toEqual([3, 4])
    expect(subtaskProgress(root)).toEqual({ completed: 1, total: 3 })
  })

  it('updates embedded copies without changing already-completed siblings', () => {
    const root = task(1, false, [task(2), task(3, true)])
    const updated = mapTaskDoneByIds(root, new Map([[1, true], [2, true]]))

    expect(updated.done).toBe(true)
    expect(updated.related_tasks?.subtask?.map((item) => item.done)).toEqual([true, true])
  })

  it('removes a deleted subtree from embedded relation caches', () => {
    const root = task(1, false, [task(2, false, [task(3)]), task(4)])
    const updated = removeTaskIdsFromTree(root, new Set([2, 3]))

    expect(updated?.related_tasks?.subtask?.map((item) => item.id)).toEqual([4])
  })

  it('resolves an expanded child for keyboard and context-menu actions', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['tasks', 'today'], [task(1, false, [task(2)])])

    expect(resolveSelectedTasks(queryClient, new Set([2])).map((item) => item.id)).toEqual([2])
  })

  it('updates fetched subtask caches and preserves their rollback snapshots', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['task-detail', 1], [task(2), task(3)])
    queryClient.setQueryData(['task-detail', 4], [task(5, false, [task(2)])])

    const previous = updateTaskDetailDone(queryClient, new Map([[2, true]]))

    expect(queryClient.getQueryData<Task[]>(['task-detail', 1])?.map((item) => item.done)).toEqual([true, false])
    expect(queryClient.getQueryData<Task[]>(['task-detail', 4])?.[0].related_tasks?.subtask?.[0].done).toBe(true)

    for (const [key, data] of previous) queryClient.setQueryData(key, data)
    expect(queryClient.getQueryData<Task[]>(['task-detail', 1])?.[0].done).toBe(false)
    expect(queryClient.getQueryData<Task[]>(['task-detail', 4])?.[0].related_tasks?.subtask?.[0].done).toBe(false)
  })

  it('renames a subtask in the fetched subtask lists and puts it back', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['task-detail', 1], [task(2), task(3)])

    const previous = updateTaskDetailFields(queryClient, 3, { title: 'Renamed' })

    expect(queryClient.getQueryData<Task[]>(['task-detail', 1])?.map((item) => item.title)).toEqual(['Task 2', 'Renamed'])

    restoreTaskDetail(queryClient, previous)
    expect(queryClient.getQueryData<Task[]>(['task-detail', 1])?.[1].title).toBe('Task 3')
  })

  it('takes a deleted subtask out of the fetched subtask lists and puts it back', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['task-detail', 1], [task(2), task(3, false, [task(4)])])

    const previous = removeFromTaskDetail(queryClient, new Set([2, 4]))

    const after = queryClient.getQueryData<Task[]>(['task-detail', 1])
    expect(after?.map((item) => item.id)).toEqual([3])
    expect(after?.[0].related_tasks?.subtask).toEqual([])

    restoreTaskDetail(queryClient, previous)
    expect(queryClient.getQueryData<Task[]>(['task-detail', 1])?.map((item) => item.id)).toEqual([2, 3])
  })
})

describe('renamedSubtaskTitle', () => {
  it('saves a changed title without the spaces around it', () => {
    expect(renamedSubtaskTitle({ title: 'Buy milk' }, '  Buy oat milk ')).toBe('Buy oat milk')
  })

  it('saves nothing for an empty or unchanged title', () => {
    expect(renamedSubtaskTitle({ title: 'Buy milk' }, '   ')).toBeNull()
    expect(renamedSubtaskTitle({ title: 'Buy milk' }, 'Buy milk ')).toBeNull()
  })
})
