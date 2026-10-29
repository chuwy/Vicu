# Planner task duration

Planner tasks may have a duration in whole minutes. Desktop quick add reads a standalone `~XX` token (`~45` is 45 minutes) everywhere it reads other task tokens; the expanded card also has a Duration property. Invalid, fractional and non-positive values are not durations.

Duration is stored in the task description as `<!-- vicu-duration:v1:45 -->`. This keeps the value in the existing Vikunja model, sync and offline queue without exposing it as notes content. Unlike carrier markers, duration is inline metadata and never hides its task from Today, Planner or other task lists.

`start_date`, `due_date` and duration are independent: duration is valid without a start date, and adding or removing a start date does not convert or erase it. `end_date` is ignored completely and is never read or written for duration.
