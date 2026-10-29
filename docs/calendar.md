# Day calendar

The day calendar is the Planner's right-side rail: a day-view calendar for one day, split into
30-minute blocks. It is a plain layout scaffold so far — no events are placed on it yet. It lives
in `src/renderer/components/planner/DayViewCalendar.tsx` and is rendered by `PlannerView` beside
the day columns (see `docs/planner.md`).

## Decisions

**Placement.** The calendar is a fixed 320 px (`w-80`) column on the right of the Planner, outside
the four-column grid so the columns keep their `minmax(200px, 1fr)` widths. It is a normal block in
the page flow: the whole Planner page scrolls, the calendar does not scroll on its own and is not
sticky (a full day is taller than the window, so pinning it would hide most of it).

**Which day.** It shows **today**. `PlannerView` passes its `now` (the local day from
`stores/day-store.ts`, so it rolls over at midnight and after resume). The header is the full date
(`formatDateDisplay('header.full')`), and every hour label is a `<time>` element.

**Grid.** The day is 48 blocks of 30 minutes (`DAY_SLOT_MINUTES`, `DAY_SLOT_COUNT` in
`src/renderer/lib/day-calendar.ts`), each 40 px tall (`h-10`), so one hour is 80 px and the whole
day is about 2000 px. Interpretation of "one hour with more solid block": the line at every full
hour is the more solid one (`border-t border-border`), while the half-hour line is lighter
(`border-t border-border/40`). The grid ends with a solid line at the last hour's bottom edge. If
the hour was meant to read as a more solid *background* block instead of a stronger line, that is a
one-line change per row and is called out in Open questions.

**Hour labels.** Only full hours are labelled; the 30-minute marks are just grid lines. Labels sit
in a 4.5 rem left gutter, right-aligned and vertically centred on the hour line (like Apple
Calendar; the line starts right of the gutter). They are formatted with
`formatDateDisplay('logbook.time')`, so they follow the user's clock setting ("9:00 AM" / "09:00").
The gutter is sized for the longest common label ("12:00 AM").

**Styling.** Everything comes from the design tokens: the card is `rounded-card border-border
bg-bg-card` with the same 12 px header band the Planner day columns use, labels are `text-meta
text-text-secondary` (12 px, nothing under 11 px), the day title is `text-section`. No arbitrary
font sizes, radii or durations, so the guard tests in `src/renderer/lib/__tests__/` pass untouched.

**Semantics.** The grid is a plain `<ol>` of hours; each hour's two blocks are decorative
(`aria-hidden`), the labels carry the meaning as `<time dateTime>` with local minute-precision ISO
values ("2026-06-10T09:00"). The section is labelled by its day heading.

**Day model.** `src/renderer/lib/day-calendar.ts` is pure and import-free: one
function, `dayTimeSlots(dayStart)`, returns the 48 slots with `minutesFromMidnight`, `isHour` and
local `start`/`isoLocal`. Slot times are built with the local `Date` constructor from the calendar
date, so a daylight-saving change does not shift the wall-clock times. Pinned by
`src/renderer/lib/__tests__/day-calendar.test.ts` under `TZ=Pacific/Auckland`.

**Not in print.** The printout (`usePrintable`) still contains only the Planner columns.

**No events yet.** Nothing reads `start_date`, `due_date` or the duration metadata
(`docs/planner.md`) to draw blocks. That is the next step and will reuse `plannerTaskSortKey`'s
placement rule (start date, else due minus duration).

## Open questions

- Should a full hour be a more solid **line** (current) or a more solid **background block**?
- Should the calendar follow a selected day column (click a column header to switch the calendar to
  that day) instead of always showing today?
- Does it need a current-time indicator and scroll-to-now?
- Independent inner scroll with the page standing still, or keep the whole page scrolling?
- Hide or collapse it below a window width?
