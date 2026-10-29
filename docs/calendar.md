# Day calendar

The day calendar is the Planner's right-side rail: a read-only schedule for the selected local
day, split into 30-minute blocks. It lives in
`src/renderer/components/planner/DayViewCalendar.tsx` and is rendered by `PlannerView` beside the
day columns (see `docs/planner.md`). Events are Vikunja tasks, not an external calendar feed.

## Task mapping

`src/renderer/lib/planner-calendar.ts` maps the Planner's loaded tasks from active projects. It
uses the same task data as the columns, so optimistic edits and completions update the calendar
without a second request. Completed tasks stay visible, with a check mark and strikethrough.

- **Start date set:** start at `start_date`; the hidden description duration determines the end.
  The due date does not stretch or move this block. A midnight start is a real start time.
- **No start, timed due date:** start at `due_date - duration`, ending at the due time.
- **No duration:** show a point marker at the start or timed due date. The marker has a minimum
  visual height of 24 px for readability; this is not a stored or inferred duration. Short events
  use the same minimum. At the bottom of the day, markers shift up just enough to remain visible.
- **No start, date-only due:** show the task under **No time**, even if it has a duration. Both
  local 23:59:59 and legacy midnight due dates are date-only; neither becomes a late-night block.
- **Neither date:** no calendar entry. The task remains available in the Unplanned column.
- **`end_date`:** never read or written for scheduling or duration.

Timed intervals are included when they overlap the selected local day and are clipped at its
boundaries; a task ending exactly at midnight does not spill into the following day. The calendar
uses the effective schedule, while Planner **columns still use the due date**. A start-only task
or a task due on another day can therefore appear in the calendar without a row in that day's
column. All open tasks are loaded; completed tasks are loaded only when their due or start date
falls in the three-day Planner window. This does not discover completed intervals whose start
and due dates are both outside that window (duration is hidden metadata, not server-filterable).

Overlapping blocks share side-by-side columns, assigned independently for each connected overlap
group. Minimum-height markers participate in overlap detection so short tasks cannot cover one
another. Full titles, times and completion state are available as accessible names and native
hover titles. Blocks are display-only: edit tasks through their existing rows, not through a
second editor or drag target in the calendar.

## Grid and local time

The day is 48 blocks of 30 minutes (`DAY_SLOT_MINUTES`, `DAY_SLOT_COUNT` in
`src/renderer/lib/day-calendar.ts`), each 36 px tall (`DAY_SLOT_HEIGHT_PX`). Inline block heights,
event positions and opening-scroll math use these same constants.

`dayTimeSlots(dayStart)` is pure and import-free. It returns `minutesFromMidnight`, `isHour`, a
local minute-precision `isoLocal` ("2026-06-10T09:00"), and a clock-only `labelTime` reference.
Labels use a fixed reference date rather than constructing an instant on the displayed day:
otherwise a spring-forward day's nonexistent 02:00 normalizes to 03:00 and duplicates that label.

Event duration is elapsed time; its position uses local wall-clock hours, not elapsed minutes
since midnight. This keeps a 09:00 event on the 09:00 line after a DST change. The fixed 24-hour
grid intentionally shows skipped hours and folds repeated hours onto the same line. An interval
whose end wall time goes backwards during fall-back remains visible as a minimum-height marker.
Tests cover Auckland and New York, including both DST transitions.

## Picking, sizing and scrolling

Click a Planner day heading to pick the calendar's day; today is the default. If a picked day
no longer has a visible heading after midnight or a resize, the calendar returns to today.

The calendar scrolls independently of the Planner columns. Its rail is `sticky` at the top and
right of the view's `ReadingScroll` area (found through `data-scroll-area`), with its full visible
height measured by a `ResizeObserver`. There is no outer padding around the rail and no reserved
scrollbar gutter: it meets the right and bottom edges without creating an extra page scrollbar.
Only the day-card grid has padding; long task columns can still scroll while the rail stays put.
The rail is 320 px wide, capped at 40% of the available width on small windows.

The board responds to the **Planner's available width**, excluding the sidebar:

- **870 px and below:** Overdue / Unplanned, Today, calendar.
- **Above 870 px through 1420 px:** add Tomorrow. At 1090 px and throughout the remaining interval,
  keep these same columns and stretch their widths.
- **Above 1420 px:** add the third day.

The remaining width is shared equally by the day cards; the board never requires horizontal
scrolling. Hidden day columns are unmounted so keyboard selection and dragging only see visible
rows. The fetched three-day window and printed sections do not change with the layout.

Once the initial task load and rail measurement are ready, the grid scrolls instantly to:

- **today** — the 30-minute block containing an hour before now (`dayOpenSlotIndex`, clamped at
  midnight early in the morning);
- **another day** — the 8 AM hour line.

The target line lands 10 px below the grid viewport's top edge (`OPEN_CLEARANCE_PX`), subject to
the browser's end-of-scroll clamp. Resizing or refreshing task data does not replay this opening
scroll. The grid is keyboard-focusable; its up/down arrows scroll it instead of selecting rows
in the Planner. No smooth scrolling or new animation, so reduced motion needs no variant.

## Styling, semantics and verification

The calendar is an edge-to-edge rail, not a day card: `border-l border-border bg-bg-card`, no
rounded corners or outer margins, and a 48 px header matching the columns.
Hour labels use `text-meta text-text-secondary`; the title uses `text-section`; task blocks use
`bg-bg-selected` with a visible border. Completion has a shape and strike, not just a colour.
There are no new font sizes, radii or durations outside the design tokens.

The hour grid is an `<ol>` with decorative half-hour blocks and `<time dateTime>` labels. Separate
labelled lists contain scheduled tasks and tasks without a time; the section is labelled by its
heading. Calendar entries deliberately do not carry `data-task-id`, which belongs exclusively to
the real task rows and their selection/drag/editor machinery.

Unit tests live in `src/renderer/lib/__tests__/day-calendar.test.ts`, `planner-calendar.test.ts`
and `planner.test.ts`. `scripts/ui-verify/scenarios/planner-calendar.mjs` checks actual scroll
position, event geometry, day selection, overlap columns, bounded fetching and narrow-window
layout. `planner-duration.mjs` also checks live calendar updates after editing a duration.
