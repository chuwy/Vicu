import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { addDrafts, type AddDraftsResult } from '@/lib/ai/add-drafts'
import { sendTaskPatch } from '@/lib/offline-mutations'
import { refreshTasks } from '@/lib/task-refresh'
import { DEFAULT_LOCATION_RADIUS } from '../../shared/synced-prefs'
import type { CheckedDraft } from '../../shared/ai/dictation'
import type { Task } from '@/lib/vikunja-types'
import { useAppConfig } from './use-app-config'
import { useLabels } from './use-labels'
import { useLocationReminders } from './use-location-reminders'
import { useAddLabel, useCreateLabel, useCreateTask } from './use-task-mutations'

/**
 * Creates checked drafts (dictation's cards, Ask's create proposals) through the composer's create
 * path (docs/ai-assistant-v1.md section 4.5): queued with their labels when the server cannot be
 * reached, the default reminder, new labels first, subtasks as relations, a place reminder.
 */
export function useAddDrafts(): (drafts: readonly CheckedDraft[], parent?: Task | null) => Promise<AddDraftsResult> {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const { data: labels = [] } = useLabels()
  const createTask = useCreateTask()
  const createLabel = useCreateLabel({ silent: true })
  const addLabel = useAddLabel({ silent: true })
  const { setReminder } = useLocationReminders()

  return useCallback(async (drafts, parent = null) => {
    const result = await addDrafts(drafts, {
      createTask: (projectId, payload, taskLabels) => createTask.mutateAsync({
        projectId,
        task: payload,
        extras: { labels: taskLabels.map((l) => ({ id: l.id, title: l.title })), displayLabels: taskLabels },
      }),
      createLabel: (title) => createLabel.mutateAsync({ title }),
      addLabel: (task, label) => addLabel.mutateAsync({ taskId: task.id, labelId: label.id }),
      createSubtaskRelation: async (parentId, childId) => {
        const res = await api.createTaskRelation(parentId, childId, 'subtask')
        if (!res.success) throw new Error(res.error)
      },
      setDescription: async (task, description) => { await sendTaskPatch(task.id, { description }, task.title) },
      setLocationReminder: (taskId, placeId, trigger) => setReminder(taskId, placeId, trigger, DEFAULT_LOCATION_RADIUS),
      knownLabels: labels,
      defaultReminder: config ?? null,
    }, { parent })
    refreshTasks(qc)
    return result
  }, [qc, config, labels, createTask, createLabel, addLabel, setReminder])
}
