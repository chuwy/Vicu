# Planner

Planner is a view allowing to visualize the progress, duration and ordering of tasks in daily/weekly view.

## Design

Planner deliberately shows completed tasks.

The right side of the Planner carries a read-only day-view calendar: 30-minute blocks with a more solid line every hour, on the day picked by clicking a day heading (today by default). Tasks map to time blocks using start date, timed due date and duration; date-only tasks sit under **No time**, completed tasks remain visible, and overlaps share side-by-side columns. Its mapping rules and decisions are in `docs/calendar.md`.

The calendar stays flush against the right edge, separate from the padded day cards. Available
Planner width (excluding the sidebar) controls the visible columns: Overdue and Today through
870 px, Tomorrow above 870 px, and the third day above 1420 px. Between these breakpoints,
including 1090–1420 px, the cards stretch instead of adding columns or horizontal scrolling.

## Implementation

`TaskRow` is aware of larger planner feature because it has smaller margins and paddings when displayed in Planner.

## First column: Overdue / Unplanned

The first column has a switch where the other columns show a task count. Left is **Overdue** (open tasks due before today, the default); right is **Unplanned**: open tasks with neither a due date nor a start date. The column is not a drop target in either mode. Dragging an Unplanned task onto a dated column gives it that date as a date-only due date.

Unplanned tasks are selected client-side (`plannerUnplannedTasks`). Vikunja's filter engine treats the Go zero time (`0001-01-01T00:00:00Z`) as "no date" and never matches it, so `due_date = '0001-01-01T00:00:00Z'` returns nothing. `plannerTaskFilter` instead fetches every open task plus tasks with a due or start date in the three-day window (even when narrower layouts hide a day). Completed history outside that window is not fetched; start dates include completed start-only calendar entries.

## Task duration

Planner tasks may have a duration in whole minutes. Desktop quick add reads a standalone `~XX` token (`~45` is 45 minutes) everywhere it reads other task tokens; the expanded card also has a Duration property. Invalid, fractional and non-positive values are not durations.

Duration is stored in the task description as `<!-- vicu-duration:v1:45 -->`. This keeps the value in the existing Vikunja model, sync and offline queue without exposing it as notes content. Unlike carrier markers, duration is inline metadata and never hides its task from Today, Planner or other task lists.

`start_date`, `due_date` and duration are independent: duration is valid without a start date, and adding or removing a start date does not convert or erase it. `end_date` is ignored completely and is never read or written for duration.

Within Overdue and each day column, Planner sorts by `start_date` when it is set. Otherwise the key is `due_date - duration`; missing duration counts as zero, so the key is simply `due_date`. Sorting happens after fetching because duration is description metadata. Column membership and drag-and-drop date changes still use `due_date`, and `end_date` has no effect on ordering.
