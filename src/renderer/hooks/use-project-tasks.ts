import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { sortProjectTasks } from '@/lib/task-sort'
import { mergeProjectUndoWindow } from '@/lib/undo-window'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'

export function useProjectTasks(projectId: number | undefined) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)

  const viewQuery = useQuery({
    queryKey: ['project-views', projectId],
    queryFn: async () => {
      const result = await api.fetchProjectViews(projectId!)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: !!projectId,
    staleTime: Infinity,
    select: (views) => views.find((v) => v.view_kind === 'list'),
  })

  const tasksQuery = useQuery({
    queryKey: ['view-tasks', projectId, viewQuery.data?.id],
    queryFn: async () => {
      const result = await api.fetchViewTasks(projectId!, viewQuery.data!.id, {
        filter: 'done = false',
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: !!viewQuery.data?.id,
    // Hidden tasks stay out by their marker, not by `done = false` alone: one someone reopened in
    // the web UI is still hidden (cross-app semantics 10.1).
    select: (tasks) => sortProjectTasks(tasks.filter((task) => !hasVicuMetadataMarker(task.description))),
  })

  // Merge recently completed tasks back so they stay visible with strikethrough
  const data = useMemo(() => {
    return mergeProjectUndoWindow(tasksQuery.data ?? [], completedTasks, pathname, projectId)
  }, [tasksQuery.data, completedTasks, pathname, projectId])

  return { ...tasksQuery, data, viewId: viewQuery.data?.id }
}
