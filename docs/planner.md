# Planner

Planner is a view allowing to visualize the progress, duration and ordering of tasks in daily/weekly view.

## Design

Planner deliberately shows completed tasks.

The right side of the Planner carries a plain day-view calendar for today: 30-minute blocks with a more solid line every hour. No events are drawn on it yet; its decisions are in `docs/calendar.md`.

## Implementation

`TaskRow` is aware of larger planner feature because it has smaller margins and paddings when displayed in Planner.

## First column: Overdue / Unplanned

The first column has a switch where the other columns show a task count. Left is **Overdue** (open tasks due before today, the default); right is **Unplanned**: open tasks with neither a due date nor a start date. The column is not a drop target in either mode.

Unplanned tasks are selected client-side (`plannerUnplannedTasks`). Vikunja's filter engine treats the Go zero time (`0001-01-01T00:00:00Z`) as "no date" and never matches it, so `due_date = '0001-01-01T00:00:00Z'` returns nothing and the Planner query instead fetches the dated window plus every open task (`plannerTaskFilter`).

## Task duration

Planner tasks may have a duration in whole minutes. Desktop quick add reads a standalone `~XX` token (`~45` is 45 minutes) everywhere it reads other task tokens; the expanded card also has a Duration property. Invalid, fractional and non-positive values are not durations.

Duration is stored in the task description as `<!-- vicu-duration:v1:45 -->`. This keeps the value in the existing Vikunja model, sync and offline queue without exposing it as notes content. Unlike carrier markers, duration is inline metadata and never hides its task from Today, Planner or other task lists.

`start_date`, `due_date` and duration are independent: duration is valid without a start date, and adding or removing a start date does not convert or erase it. `end_date` is ignored completely and is never read or written for duration.

Within Overdue and each day column, Planner sorts by `start_date` when it is set. Otherwise the key is `due_date - duration`; missing duration counts as zero, so the key is simply `due_date`. Sorting happens after fetching because duration is description metadata. Column membership and drag-and-drop date changes still use `due_date`, and `end_date` has no effect on ordering.
