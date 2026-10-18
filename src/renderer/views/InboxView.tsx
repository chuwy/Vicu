import { useEffect, useMemo } from 'react'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useAppConfig } from '@/hooks/use-app-config'
import { useReorderStore } from '@/stores/reorder-store'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { ListSkeleton } from '@/components/shared/ListSkeleton'

export function InboxView() {
  // The Inbox is a synced setting: it can change while the view is open (another device chose one).
  const { data: config } = useAppConfig()
  const inboxProjectId = config?.inbox_project_id || undefined
  const { data: projects, isLoading: projectsLoading } = useProjects()

  const activeInboxId = inboxProjectId && projects?.flat.some((project) => project.id === inboxProjectId)
    ? inboxProjectId
    : undefined
  const { data: tasks = [], isLoading, viewId } = useProjectTasks(activeInboxId)
  const rowView = useMemo(() => ({ projectId: activeInboxId }), [activeInboxId])
  const setReorderContext = useReorderStore((s) => s.setReorderContext)

  useEffect(() => {
    setReorderContext(viewId ?? null, tasks)
  }, [viewId, tasks, setReorderContext])

  usePrintable(
    useMemo(() => ({ viewTitle: 'Inbox', sections: [{ groups: [{ tasks }] }] }), [tasks])
  )

  if (isLoading || projectsLoading) {
    return <ListSkeleton title="Inbox" identity="inbox" />
  }

  return (
    <RowViewProvider value={rowView}>
      <TaskList
        title="Inbox"
        identity="inbox"
        tasks={tasks}
        projectId={activeInboxId}
        sortable
        viewId={viewId}
        emptyTitle={inboxProjectId && !activeInboxId ? 'Inbox project is archived' : 'Nothing in Inbox'}
        emptySubtitle={inboxProjectId && !activeInboxId ? 'Select an active Inbox project in Settings' : 'Tasks added here will be sorted later'}
      />
    </RowViewProvider>
  )
}
