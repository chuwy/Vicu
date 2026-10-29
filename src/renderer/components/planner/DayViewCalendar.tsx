import { useDateFormat } from '@/hooks/use-date-format'
import { cn } from '@/lib/cn'
import { dayTimeSlots, type DayTimeSlot } from '@/lib/day-calendar'
import { formatDateDisplay } from '@/lib/date-display'
import { startOfLocalDay, toLocalDate } from '@/lib/due-dates'

interface DayViewCalendarProps {
  /** The local day the calendar shows; Planner passes today. */
  day: Date
  className?: string
}

interface DayHourRowProps {
  slot: DayTimeSlot
  /** The hour label, formatted with the user's clock setting ("9:00 AM", "09:00"). */
  label: string
  isLast: boolean
}

function DayHourRow({ slot, label, isLast }: DayHourRowProps) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr]">
      <div className="relative">
        {/* The label is centred on the hour line, in the gutter left of the grid. */}
        <time
          dateTime={slot.isoLocal}
          className="absolute right-2 top-0 -translate-y-1/2 whitespace-nowrap text-meta text-text-secondary"
        >
          {label}
        </time>
      </div>
      <div className={cn(isLast && 'border-b border-border')}>
        {/* The hour line is the more solid one; the half-hour line is lighter (docs/calendar.md). */}
        <div className="h-10 border-t border-border" aria-hidden="true" />
        <div className="h-10 border-t border-border/40" aria-hidden="true" />
      </div>
    </li>
  )
}

/**
 * The Planner's right-side day calendar (docs/calendar.md). A plain day grid for one local day:
 * 48 half-hour blocks, every hour line more solid than the half-hour line and an hour label in the
 * left gutter. No events are drawn yet.
 */
export function DayViewCalendar({ day, className }: DayViewCalendarProps) {
  const dateFormat = useDateFormat()
  const dayStart = startOfLocalDay(day)
  const hours = dayTimeSlots(dayStart).filter((slot) => slot.isHour)
  const title = formatDateDisplay('header.full', dayStart, new Date(), true, dateFormat)

  return (
    <section
      aria-labelledby="day-calendar-title"
      className={cn('overflow-hidden rounded-card border border-border bg-bg-card', className)}
    >
      <header className="flex h-12 items-center border-b border-border px-4">
        <h2 id="day-calendar-title" className="min-w-0 flex-1 truncate text-section text-text">
          <time dateTime={toLocalDate(dayStart)}>{title}</time>
        </h2>
      </header>
      {/* pt-3 leaves room for the midnight label, which is centred on the top line. */}
      <ol className="px-4 pb-3 pt-3">
        {hours.map((slot, index) => (
          <DayHourRow
            key={slot.minutesFromMidnight}
            slot={slot}
            label={formatDateDisplay('logbook.time', slot.start, dayStart, false, dateFormat)}
            isLast={index === hours.length - 1}
          />
        ))}
      </ol>
    </section>
  )
}
