import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useDateFormat } from '@/hooks/use-date-format'
import { cn } from '@/lib/cn'
import {
  DAY_SLOT_HEIGHT_PX,
  DAY_SLOT_MINUTES,
  dayOpenSlotIndex,
  dayTimeSlots,
  type DayTimeSlot,
} from '@/lib/day-calendar'
import { formatDateDisplay } from '@/lib/date-display'
import { startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import type { PlannerCalendarEvents } from '@/lib/planner-calendar'
import type { Task } from '@/lib/vikunja-types'

interface DayViewCalendarProps {
  /** The selected local day; today by default. */
  day: Date
  events: PlannerCalendarEvents
  isLoading: boolean
  className?: string
}

function DayHourRow({ slot, label, isLast }: { slot: DayTimeSlot; label: string; isLast: boolean }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr]">
      <div className="relative">
        <time
          dateTime={slot.isoLocal}
          className="absolute right-2 top-0 -translate-y-1/2 whitespace-nowrap text-meta text-text-secondary"
        >
          {label}
        </time>
      </div>
      <div className={cn(isLast && 'border-b border-border')}>
        <div className="border-t border-border" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
        <div className="border-t border-border/40" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
      </div>
    </li>
  )
}

function CalendarTaskTitle({ task }: { task: Task }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {task.done && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className={cn('truncate', task.done && 'line-through')}>{task.title}</span>
    </span>
  )
}

/** Leave the hour label above the open line whole. */
const OPEN_CLEARANCE_PX = 10
const GRID_PADDING_PX = 12
const PIXELS_PER_MINUTE = DAY_SLOT_HEIGHT_PX / DAY_SLOT_MINUTES

/** A read-only task schedule on the fixed, 48-block local wall-clock grid (docs/calendar.md). */
export function DayViewCalendar({ day, events, isLoading, className }: DayViewCalendarProps) {
  const dateFormat = useDateFormat()
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const openedDay = useRef<string | null>(null)
  const [railHeight, setRailHeight] = useState<number | null>(null)
  const dayKey = toLocalDate(day)
  const dayStart = startOfLocalDay(dayKey)
  const hours = dayTimeSlots(dayStart).filter((slot) => slot.isHour)
  const title = formatDateDisplay('header.full', dayStart, new Date(), true, dateFormat)
  const timeLabel = (value: Date) => formatDateDisplay('logbook.time', value, dayStart, false, dateFormat)

  useLayoutEffect(() => {
    const scroller = sectionRef.current?.closest('[data-scroll-area]')
    if (!(scroller instanceof HTMLElement)) return
    const update = () => setRailHeight(scroller.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Wait until the rail actually has its measured height; before that, the full grid fits and
  // the browser clamps scrollTop to zero. Also wait for tasks: the No time band changes the grid's
  // viewport height. Resizes and task refreshes must not reset user scrolling.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || isLoading || railHeight === null || railHeight <= 0 || openedDay.current === dayKey) return
    const now = new Date()
    const slotIndex = dayOpenSlotIndex(dayKey === toLocalDate(now), now)
    scroller.scrollTop = GRID_PADDING_PX + slotIndex * DAY_SLOT_HEIGHT_PX - OPEN_CLEARANCE_PX
    openedDay.current = dayKey
  }, [dayKey, railHeight, isLoading])

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      style={{ height: railHeight ?? undefined }}
      className={cn('sticky top-0 right-0 flex min-w-0 flex-col overflow-hidden border-l border-border bg-bg-card', className)}
    >
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-section text-text">
          <time dateTime={dayKey}>{title}</time>
        </h2>
      </header>
      {events.anytime.length > 0 && (
        <div className="max-h-32 shrink-0 overflow-y-auto border-b border-border px-4 py-2">
          <h3 className="mb-1 text-meta text-text-secondary">No time</h3>
          <ul aria-label="Tasks without a time" className="space-y-1">
            {events.anytime.map((task) => (
              <li
                key={task.id}
                data-calendar-task={task.id}
                title={task.title}
                aria-label={`${task.title}${task.done ? ', completed' : ''}`}
                className="rounded-control border border-border bg-bg-hover px-2 py-1 text-meta text-text"
              >
                <CalendarTaskTitle task={task} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        ref={scrollRef}
        role="region"
        aria-label="Day schedule"
        tabIndex={0}
        onKeyDown={(event) => {
          // Let this scroll region's arrows scroll it, rather than moving focus to a Planner row.
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation()
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        style={{ paddingBlock: GRID_PADDING_PX }}
      >
        <div className="relative">
          <ol aria-label="Hours">
            {hours.map((slot, index) => (
              <DayHourRow key={slot.minutesFromMidnight} slot={slot} label={timeLabel(slot.labelTime)} isLast={index === hours.length - 1} />
            ))}
          </ol>
          <ol aria-label="Scheduled tasks" className="absolute inset-y-0 left-[4.5rem] right-0">
            {events.timed.map((event) => {
              const range = event.end ? `${timeLabel(event.start)} – ${timeLabel(event.end)}` : timeLabel(event.start)
              const label = `${event.task.title}, ${range}${event.task.done ? ', completed' : ''}`
              const height = (event.endMinute - event.startMinute) * PIXELS_PER_MINUTE
              return (
                <li
                  key={event.task.id}
                  data-calendar-task={event.task.id}
                  aria-label={label}
                  title={label}
                  style={{
                    top: event.startMinute * PIXELS_PER_MINUTE,
                    height,
                    left: `${event.column / event.columnCount * 100}%`,
                    width: `${100 / event.columnCount}%`,
                  }}
                  className="absolute overflow-hidden rounded-control border border-accent-blue bg-bg-selected px-1.5 text-meta text-text"
                >
                  <CalendarTaskTitle task={event.task} />
                  {height >= 44 && <span className="block truncate text-caption text-text-secondary">{range}</span>}
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
