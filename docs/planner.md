# Planner task duration

Planner tasks may have a duration in whole minutes. Desktop quick add reads a standalone `~XX` token (`~45` is 45 minutes) everywhere it reads other task tokens; the expanded card also has a Duration property. Invalid, fractional and non-positive values are not durations.

Duration is stored in the task description as `<!-- vicu-duration:v1:45 -->`. This keeps the value in the existing Vikunja model, sync and offline queue without exposing it as notes content. Unlike carrier markers, duration is inline metadata and never hides its task from Today, Planner or other task lists.

`start_date`, `due_date` and duration are independent: duration is valid without a start date, and adding or removing a start date does not convert or erase it. `end_date` is ignored completely and is never read or written for duration.

Within Overdue and each day column, Planner sorts by `start_date` when it is set. Otherwise the key is `due_date - duration`; missing duration counts as zero, so the key is simply `due_date`. Sorting happens after fetching because duration is description metadata. Column membership and drag-and-drop date changes still use `due_date`, and `end_date` has no effect on ordering.
