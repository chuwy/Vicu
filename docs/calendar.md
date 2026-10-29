# Day calendar

The day calendar is the Planner's right-side rail: a day-view calendar for one day, split into
30-minute blocks. It lives in `src/renderer/components/planner/DayViewCalendar.tsx` and is 
rendered by `PlannerView` beside the day columns (see `docs/planner.md`).

## Decisions

**Picking the day.** The calendar shows the day picked by clicking one of the Planner's day
headings; today is shown by default. 

**Grid.** The day is 48 blocks of 30 minutes (`DAY_SLOT_MINUTES`, `DAY_SLOT_COUNT` in
`src/renderer/lib/day-calendar.ts`), each 36 px tall (`DAY_SLOT_HEIGHT_PX`). The block 
height is rendered as an inline height from the one constant, so the scroll math cannot drift
from the layout.

**Scrolling.** The calendar scrolls independently of the Planner columns. The rail is `sticky` in
the view's scroll area (`ReadingScroll`, found through its `data-scroll-area` marker) and its
height is the scroll area's visible height (measured with a `ResizeObserver`, so window resizes are
followed). When a day opens (the app starting or a day being picked) the grid scrolls instantly to:

- **today** — the 30-minute block containing an hour before now at the top (`dayOpenSlotIndex`,
  clamped to the start of the day early in the morning);
- **any other day** — the 8 AM hour line at the top.

The target line lands 10 px below the rail's top edge (`OPEN_CLEARANCE_PX`) so the hour label on
it is never half-clipped. No smooth scrolling anywhere, so reduced motion needs no variant.

**Styling.** Everything comes from the design tokens: the card is `rounded-card border-border
bg-bg-card` with the same 12 px header band the Planner day columns use, labels are `text-meta
text-text-secondary` (12 px, nothing under 11 px), the day title is `text-section`, the picked
heading is `text-accent-blue`, hover is `bg-bg-hover`, and the heading buttons use
`rounded-control`. No arbitrary font sizes, radii or durations, so the guard tests in
`src/renderer/lib/__tests__/` pass untouched.

**Semantics.** The grid is a plain `<ol>` of hours; each hour's two blocks are decorative
(`aria-hidden`), the labels carry the meaning as `<time dateTime>` with local minute-precision ISO
values ("2026-06-10T09:00"). The section is labelled by its day heading. The day headings are real
buttons, so picking a day works from the keyboard.

**Day model.** `src/renderer/lib/day-calendar.ts` is pure and import-free: `dayTimeSlots(dayStart)`
returns the 48 slots with `minutesFromMidnight`, `isHour` and local `start`/`isoLocal`, and
`dayOpenSlotIndex(isToday, now)` is the open rule above. Slot times are built with the local
`Date` constructor from the calendar date, so a daylight-saving change does not shift the
wall-clock times. Pinned by `src/renderer/lib/__tests__/day-calendar.test.ts` under
`TZ=Pacific/Auckland`.

