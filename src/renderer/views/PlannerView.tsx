import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { DayViewCalendar } from '@/components/planner/DayViewCalendar'
import { Switch } from '@/components/shared/Switch'
import { DueDateContextProvider } from '@/components/task-list/TaskDueBadge'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useDateFormat } from '@/hooks/use-date-format'
import { useDayKey } from '@/stores/day-store'
import { usePrintable } from '@/stores/print-store'
import { cn } from '@/lib/cn'
import { formatDateDisplay } from '@/lib/date-display'
import { startOfLocalDay, toLocalDate, type LocalDate } from '@/lib/due-dates'
import { openCount } from '@/lib/list-sections'
import { groupPlannerTasks, plannerTaskFilter, plannerUnplannedTasks, type PlannerDay } from '@/lib/planner'
import type { Project, TaskQueryParams } from '@/lib/vikunja-types'

interface PlannerColumnDay extends PlannerDay {
  label: string
}

interface PlannerDayColumnProps {
  day: PlannerColumnDay
  projectsById: ReadonlyMap<number, Project>
  isLoading: boolean
  /** This column's day is the one the right-side day calendar shows. */
  selected?: boolean
  onSelect?: (date: LocalDate) => void
  showUnplanned?: boolean
  onShowUnplannedChange?: (show: boolean) => void
}

function PlannerDayColumn({
  day,
  projectsById,
  isLoading,
  selected = false,
  onSelect,
  showUnplanned = false,
  onShowUnplannedChange,
}: PlannerDayColumnProps) {
  const columnId = `planner-column-${day.date ?? 'overdue'}`
  const date = day.date
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
        <h2 id={columnId} className="min-w-0 flex-1">
          {date === null ? (
            <span
              className={cn(
                'block truncate text-section',
                !showUnplanned ? 'text-status-overdue' : 'text-text',
              )}
            >
              {day.label}
            </span>
          ) : (
            <button
              type="button"
              aria-current={selected ? 'date' : undefined}
              onClick={() => onSelect?.(date)}
              title="Show this day in the calendar"
              className={cn(
                '-mx-2 block w-full truncate rounded-control px-2 text-left text-section transition-colors duration-fade-fast hover:bg-bg-hover',
                selected ? 'text-accent-blue' : 'text-text',
              )}
            >
              <time dateTime={date}>{day.label}</time>
            </button>
          )}
        </h2>
        {day.date === null ? (
          <Switch
            aria-label="Show unplanned tasks"
            checked={showUnplanned}
            onCheckedChange={(show) => onShowUnplannedChange?.(show)}
          />
        ) : !isLoading && (
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
                  trailing="duration"
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
  const [showUnplanned, setShowUnplanned] = useState(false)
  const [selectedDay, setSelectedDay] = useState<LocalDate | null>(null)
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
  const activeProjectIds = useMemo(() => new Set(projectsById.keys()), [projectsById])
  const unplannedTasks = useMemo(
    () => plannerUnplannedTasks(tasks, activeProjectIds),
    [tasks, activeProjectIds],
  )
  const days = useMemo(
    () => groupPlannerTasks(tasks, activeProjectIds, now).map((day) => ({
      ...day,
      tasks: day.date === null && showUnplanned ? unplannedTasks : day.tasks,
      label: day.date === null
        ? (showUnplanned ? 'Unplanned' : 'Overdue')
        : formatDateDisplay('header.day', startOfLocalDay(day.date), now, true, dateFormat),
    })),
    [tasks, activeProjectIds, unplannedTasks, showUnplanned, now, dateFormat],
  )
  // The day the right-side calendar shows: the picked day, or today (docs/calendar.md).
  const calendarDate = selectedDay ?? toLocalDate(now)
  const calendarDay = useMemo(() => startOfLocalDay(calendarDate), [calendarDate])

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
        <div aria-busy={isLoading} className="flex w-full min-w-0 items-start gap-4 px-6 pb-6 pt-2">
          <div className="grid min-w-0 flex-1 grid-cols-[repeat(4,minmax(200px,1fr))] items-start gap-4">
            {days.map((day) => (
              <PlannerDayColumn
                key={day.date ?? 'overdue'}
                day={day}
                projectsById={projectsById}
                isLoading={isLoading}
                selected={day.date === calendarDate}
                onSelect={setSelectedDay}
                showUnplanned={showUnplanned}
                onShowUnplannedChange={setShowUnplanned}
              />
            ))}
          </div>
          {/* The day calendar is a plain layout scaffold for now (docs/calendar.md). */}
          <DayViewCalendar day={calendarDay} className="w-80 shrink-0" />
        </div>
      </TaskList>
    </DueDateContextProvider>
  )
}
