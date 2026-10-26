import { useDictationStore } from '@/stores/dictation-store'
import type { Task } from '@/lib/vikunja-types'
import { notesPlainText } from './task-summary'

/**
 * "Break into steps" (docs/ai-assistant-v1.md section 4): the task's title and notes go through the
 * dictation request, and the answer's tasks, once checked and added, become its subtasks.
 */
export function breakIntoSteps(task: Pick<Task, 'id' | 'title' | 'description' | 'project_id'>, projectTitle?: string): void {
  const notes = notesPlainText(task.description)
  useDictationStore.getState().open({
    transcript: notes ? `${task.title}\n\n${notes}` : task.title,
    list: { name: projectTitle ?? 'Inbox', projectId: task.project_id, defaultDue: null },
    source: 'steps',
    parent: { id: task.id, title: task.title, project_id: task.project_id },
  })
}
