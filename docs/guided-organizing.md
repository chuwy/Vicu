# Guided organizing (desktop)

It is hard to decide about tasks you have forgotten. Guided organizing walks you through them one
decision at a time: Vicu picks what needs a decision and shows one task (or one project) at a time
with how far along you are, and you decide. It works without the assistant; with Ask set up, a
model suggests a decision for each card and you still decide. Vicu mobile has the same sessions and
picks the same tasks in the same order; the rules are in `docs/cross-app-semantics-v1.md`, section
14.

## The sessions

| Session | What it shows | Where to start it |
|---|---|---|
| Sort the Inbox | every open task in the Inbox, in the Inbox's order | the Inbox header, the command palette, Ask, the weekly review |
| Sort out overdue | every open task past its date, the oldest first | the command palette, Ask, the weekly review |
| Waiting a long time | tasks outside the Inbox without a date or a repeat that nobody touched for 60 days or more (at most 30) | the command palette, the weekly review |
| Review projects | each project due for review, one page each | the Review view (Start review), the command palette, Ask, the weekly review |

The tasks are picked when the session starts. A task finished or deleted elsewhere by the time its
card comes is passed over. Tasks in archived projects, and in projects shared with you read only,
never come up.

## A card

A card shows the task's title, project, date and labels, and how long ago it was added. You can:

- give it a date: Today, Tomorrow, This weekend, Next week, a date from the When panel, or No date;
- move it to another project;
- change the title right on the card;
- **Complete** or **Delete** it (Delete asks first when "Confirm before deleting" is on);
- **Skip** it.

**Next** saves the card's choices together (offline they wait in the queue like any change) and
shows the next card; Next without a change is a Skip. **Back** shows the previous card again, as
the task is now. At the end, a summary says what changed ("Sorted 12: 5 scheduled, 4 moved,
2 completed, 1 deleted") and **Undo all** puts every change back, except deletes.

The keyboard does everything: Enter for Next, Left for Back, S to skip, 1 to 4 for the quick
dates, D to pick a date, 0 for no date, P for the project, E for the title, C to complete, Delete to
delete, and Esc to leave.

## Reviewing projects

Each project due for review gets one page:

1. Its name, when it was last reviewed, and a health line such as "7 open · 4 untouched for 30+
   days · 1 overdue · last done 6 days ago".
2. **Still working on it?** Keep it, or Archive it (the next project comes; an archived project is
   not marked reviewed). The Inbox cannot be archived.
3. **Untouched for 30+ days**: its tasks nobody changed in a month, the oldest first, each with a
   date, a project, Complete or Delete.
4. **Next step**: the first open task in the project's order (or the one the assistant suggests),
   with the quick dates; or name a new task and Add it to the project.
5. **Mark reviewed** (R) records the review and goes on; **Skip** (S) goes on without it.

A subproject is reviewed as a project of its own. The summary's Undo all also takes back the
reviews, the archives and the tasks you added.

## The weekly review

Review, **Weekly review** (or "Weekly review" in the command palette) is a checklist in GTD order:

1. Sort the Inbox
2. Anything on your mind? (a brain dump when smart dictation is set up, otherwise add tasks to the
   Inbox right there)
3. Look back: what you finished in the last 7 days
4. Overdue
5. Look ahead: what is due in the next two weeks
6. Review projects (while project review is on)
7. Waiting a long time

**Next** opens the first step not done yet; any step can be opened. A step is done when its session
ends or you press Mark done, and a step with nothing in it is done from the start. **Finish**, at
any time, records the day of the review; it syncs, so your phone knows it too. A week later Ask
offers the weekly review again.

## With the assistant

With Ask set up (Settings, Assistant), each card comes with a suggestion: the choices it would make
are filled in with a dashed outline, and its reason is under the title ("Like your other Health
tasks"). Change or clear any of it; nothing is saved until you press Next. When it thinks a task is
finished or outdated, Complete or Delete says "Suggested", but it is never done for you. The tasks
go to the model twenty at a time, the next twenty a few cards before you need them, so you can
decide a card before its suggestion arrives. If a request fails, the session says so once and goes
on without suggestions. Suggestions use Ask's model and what you agreed to for Ask; there is no
other setting.

What is sent for suggestions: the names of your projects, labels and places, today's date, and the
session's tasks (title, project, dates, labels, priority, when they were added and changed, and the
first 500 characters of their notes).

When Ask opens on an empty conversation it starts with what needs a decision (the Inbox, overdue
tasks, projects due for review, the weekly review when a week has passed), each opening its
session, then a few questions for the list you are in. Pressing one sends it as written.
