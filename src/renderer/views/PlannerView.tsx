import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { DueDateContextProvider } from '@/components/task-list/TaskDueBadge'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useDateFormat } from '@/hooks/use-date-format'
import { useDayKey } from '@/stores/day-store'
import { usePrintable } from '@/stores/print-store'
import { cn } from '@/lib/cn'
import { formatDateDisplay } from '@/lib/date-display'
import { startOfLocalDay } from '@/lib/due-dates'
import { openCount } from '@/lib/list-sections'
import { groupPlannerTasks, plannerTaskFilter, type PlannerDay } from '@/lib/planner'
import type { Project, TaskQueryParams } from '@/lib/vikunja-types'

interface PlannerColumnDay extends PlannerDay {
  label: string
}

interface PlannerDayColumnProps {
  day: PlannerColumnDay
  projectsById: ReadonlyMap<number, Project>
  isLoading: boolean
}

function PlannerDayColumn({ day, projectsById, isLoading }: PlannerDayColumnProps) {
  const columnId = `planner-column-${day.date ?? 'overdue'}`
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    data: { type: 'planner-day', date: day.date },
    disabled: day.date === null,
  })

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={columnId}
      className={cn(
        'min-w-0 self-start overflow-hidden rounded-card border border-border bg-bg-card transition-colors duration-fade-fast',
        isOver && 'bg-accent-blue/5 ring-2 ring-inset ring-accent-blue',
      )}
    >
      <header className="flex h-12 items-center gap-2 border-b border-border px-4">
        <h2
          id={columnId}
          className={cn('min-w-0 flex-1 truncate text-section', day.date === null ? 'text-status-overdue' : 'text-text')}
        >
          {day.date === null ? day.label : <time dateTime={day.date}>{day.label}</time>}
        </h2>
        {!isLoading && (
          <span className="shrink-0 text-meta text-text-secondary">{openCount(day.tasks)}</span>
        )}
      </header>

      {isLoading ? (
        <div aria-hidden="true" className="px-4 py-2">
          {['w-3/5', 'w-2/5', 'w-1/2'].map((width) => (
            <div key={width} className="flex items-center gap-3 py-2.5">
              <span className="vicu-shimmer h-5 w-5 shrink-0 rounded-full bg-bg-hover" />
              <span className={`vicu-shimmer h-3.5 rounded-control bg-bg-hover ${width}`} />
            </div>
          ))}
        </div>
      ) : day.tasks.length > 0 ? (
        <DueDateContextProvider value={day.date === null ? 'row' : 'row.inDayGroup'}>
          <TaskRowGroup>
            {day.tasks.map((task) => {
              const project = projectsById.get(task.project_id)
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  projectMeta={{ title: project?.title ?? 'Unknown Project', color: project?.hex_color }}
                />
              )
            })}
          </TaskRowGroup>
        </DueDateContextProvider>
      ) : (
        <p className="px-4 py-8 text-center text-meta text-text-secondary">No tasks</p>
      )}
    </section>
  )
}

export function PlannerView() {
  const dayKey = useDayKey()
  const now = useMemo(() => new Date(), [dayKey])
  const params = useMemo<TaskQueryParams>(() => ({
    filter: plannerTaskFilter(now),
    sort_by: 'due_date',
    order_by: 'asc',
  }), [now])
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(params)
  const { data: projectData, isLoading: projectsLoading } = useProjects()
  const dateFormat = useDateFormat()
  const isLoading = tasksLoading || projectsLoading

  const projectsById = useMemo(
    () => new Map(projectData?.flat.map((project) => [project.id, project]) ?? []),
    [projectData?.flat],
  )
  const days = useMemo(
    () => groupPlannerTasks(tasks, new Set(projectsById.keys()), now).map((day) => ({
      ...day,
      label: day.date === null
        ? 'Overdue'
        : formatDateDisplay('header.day', startOfLocalDay(day.date), now, true, dateFormat),
    })),
    [tasks, projectsById, now, dateFormat],
  )

  usePrintable(useMemo(() => ({
    viewTitle: 'Planner',
    sections: days.map((day) => ({
      heading: day.label,
      groups: [{ tasks: day.tasks }],
    })),
  }), [days]))

  return (
    <DueDateContextProvider value="row.inDayGroup">
      <TaskList title="Planner" tasks={[]} showNewTask={false} empty={false} wide>
        {isLoading && <span role="status" className="sr-only">Loading Planner</span>}
        <div
          aria-busy={isLoading}
          className="grid w-full min-w-0 grid-cols-[repeat(4,minmax(200px,1fr))] items-start gap-4 px-6 pb-6 pt-2"
        >
          {days.map((day) => (
            <PlannerDayColumn
              key={day.date ?? 'overdue'}
              day={day}
              projectsById={projectsById}
              isLoading={isLoading}
            />
          ))}
        </div>
      </TaskList>
    </DueDateContextProvider>
  )
}
