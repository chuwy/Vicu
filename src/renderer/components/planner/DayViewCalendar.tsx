import { useLayoutEffect, useRef, useState } from 'react'
import { useDateFormat } from '@/hooks/use-date-format'
import { cn } from '@/lib/cn'
import {
  DAY_SLOT_HEIGHT_PX,
  dayOpenSlotIndex,
  dayTimeSlots,
  type DayTimeSlot,
} from '@/lib/day-calendar'
import { formatDateDisplay } from '@/lib/date-display'
import { startOfLocalDay, toLocalDate } from '@/lib/due-dates'

interface DayViewCalendarProps {
  /** The local day the calendar shows; Planner passes the day its headings select, today by default. */
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
        <div className="border-t border-border" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
        <div className="border-t border-border/40" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
      </div>
    </li>
  )
}

/** Matches the `top-2` of the pinned rail: the rail is inset from the scroll area on both ends. */
const RAIL_INSET_PX = 8
/** Keeps the hour label of the open line whole: the line lands this far below the rail's top edge. */
const OPEN_CLEARANCE_PX = 10

/**
 * The Planner's right-side day calendar (docs/calendar.md). A plain day grid for one local day:
 * 48 half-hour blocks, every hour line more solid than the half-hour line and an hour label in the
 * left gutter. The rail is pinned in the view's scroll area and the grid scrolls inside it; the day
 * opens one hour before now (today) or at 8 AM (any other day). No events are drawn yet.
 */
export function DayViewCalendar({ day, className }: DayViewCalendarProps) {
  const dateFormat = useDateFormat()
  const sectionRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [railHeight, setRailHeight] = useState<number | null>(null)
  const dayStart = startOfLocalDay(day)
  const hours = dayTimeSlots(dayStart).filter((slot) => slot.isHour)
  const title = formatDateDisplay('header.full', dayStart, new Date(), true, dateFormat)

  // The rail fills the visible part of the view's scroll area (found through data-scroll-area) and
  // stays pinned there while the Planner columns scroll past; the grid scrolls inside the rail.
  useLayoutEffect(() => {
    const scroller = sectionRef.current?.closest('[data-scroll-area]')
    if (!(scroller instanceof HTMLElement)) return
    const update = () => setRailHeight(scroller.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // The day opens at its start slot, instantly (no animation to chase after a day switch).
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const now = new Date()
    const slotIndex = dayOpenSlotIndex(toLocalDate(day) === toLocalDate(now), now)
    const row = list.children.item(Math.floor(slotIndex / 2))
    if (!row) return
    const rowTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    list.scrollTop = rowTop + (slotIndex % 2) * DAY_SLOT_HEIGHT_PX - OPEN_CLEARANCE_PX
  }, [day])

  return (
    <section
      ref={sectionRef}
      aria-labelledby="day-calendar-title"
      style={{
        top: RAIL_INSET_PX,
        height: railHeight === null ? undefined : railHeight - 2 * RAIL_INSET_PX,
      }}
      className={cn(
        'sticky flex flex-col overflow-hidden rounded-card border border-border bg-bg-card',
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 id="day-calendar-title" className="min-w-0 flex-1 truncate text-section text-text">
          <time dateTime={toLocalDate(dayStart)}>{title}</time>
        </h2>
      </header>
      {/* pt-3 leaves room for the midnight label, which is centred on the top line. */}
      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
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
