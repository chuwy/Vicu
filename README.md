# Vicu

A fast, keyboard-driven task manager for your desktop, powered by [Vikunja](https://vikunja.io/).

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Built with](https://img.shields.io/badge/electron%20+%20react%20+%20typescript-47848F)

> **Vicu is also on your phone.** [Vicu for Android and iOS](https://github.com/rendyhd/Vicu-Mobile) works with the same Vikunja server and reads your data by the same rules, so your tasks, Inbox, task order, custom lists, routines and places follow you. Get it: [iPhone and iPad (TestFlight)](https://testflight.apple.com/join/c6wuvXrH) · [Android (Google Play beta)](https://github.com/rendyhd/Vicu-Mobile#download) · [Android APK](https://github.com/rendyhd/Vicu-Mobile/releases/latest)

<p align="center">
  <img width="2260" height="1000" src="https://github.com/user-attachments/assets/6d70e449-0339-45cd-8616-42524476ee86">
</p>

## Contents

- [What is Vicu?](#what-is-vicu)
- [Capture from anywhere](#capture-from-anywhere)
- [Add tasks by voice](#add-tasks-by-voice)
- [Review without switching](#review-without-switching)
- [Natural language input](#natural-language-input)
- [Organize your work](#organize-your-work)
- [Working with tasks](#working-with-tasks)
- [Reminders](#reminders)
- [Share projects with others](#share-projects-with-others)
- [Obsidian and browser links](#obsidian-and-browser-links)
- [Sync, offline and your other devices](#sync-offline-and-your-other-devices)
- [Look and feel](#look-and-feel)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Getting started](#getting-started)
- [Building from source](#building-from-source)

## What is Vicu?

Vicu turns Vikunja into a task manager that lives on your desktop. Press a hotkey from any app to capture a task in two seconds, without leaving what you are doing. Press another to check your list. Hold + and say a task out loud.

Everything is organized around when things need to happen: tasks land in your **Inbox**, get scheduled into **Today** or **Upcoming**, sit in **Anytime** as your open backlog, and end up in the **Logbook** when done. No Kanban boards and no Gantt charts, just a simple flow from "I need to do this" to "it's done". When you do work with other people, share a project, assign tasks and talk about them in comments; if you share nothing, none of that shows.

If you work in Obsidian, Vicu bridges your notes and your tasks: link the active note to a task with a keystroke, and jump back to it from anywhere in the app.

<p align="center">
  <img width="2260" height="1000" src="https://github.com/user-attachments/assets/87c36829-f7d9-458a-b5f4-9cfaca1053af">
</p>

## Capture from anywhere

**Quick Entry** is Vicu's defining feature. Press its hotkey from any app (`Alt+Shift+V` on Windows and Linux, `Cmd+Shift+Space` on macOS) and a floating popup appears. Type your task, set a date, pick a project, hit Enter: it's captured and the popup is gone. You stay in flow.

- Natural language works here too, with the same suggestions and chips as the main window: `Call Ana tomorrow 3pm #work @phone`.
- Add a `!` at the start or end of the title to make it due today.
- Hold a modifier key and press the arrow keys to cycle through projects without opening a dropdown.
- Add notes below the title; they keep their paragraphs.
- Link the active Obsidian note or browser tab with `Ctrl+L` (see [Obsidian and browser links](#obsidian-and-browser-links)).
- "Call mom when I get home" sets a [location reminder](#reminders) at a place your phone saved.
- Works offline: a task captured while the server is unreachable is queued and sent later.

Quick Entry and Quick View are off until you turn them on in **Settings, Quick Entry / View**, where you can also record your own hotkeys.

In the main window, `Ctrl+N` (`Cmd+N`) opens the new-task composer, and `Ctrl+V` (`Cmd+V`) on a list turns the clipboard into a task. Pasting several lines creates one task per line.

Quick Entry was originally a standalone companion app ([vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)) and is now built into Vicu.

## Add tasks by voice

- **Hold + to say a task.** Hold the + in a page header, the New task row or an empty list and speak. Your words show in a card as they are recognized, with the date, project and labels picked out the way quick add reads them. Let go to add the task; press Esc or slide away to cancel. A click still opens the composer.
- **The task goes to the list on screen**: in a project it goes to that project, in Today it gets today's date, in a custom list it goes to the list's add-to project. A project or date you say wins.
- **Voice shortcut**: record one in **Settings, Keyboard Shortcuts** (off until you do). Hold it to talk, or tap it to keep listening until you press it again or Enter. "Say a task" in the command palette starts it too.
- Your default reminder is added when the task has a due date.
- Speech recognition runs on macOS (on the device when your language allows it) and on Windows. Vicu asks for microphone and speech access the first time. On Linux the composer opens instead.

## Review without switching

**Quick View** (`Alt+Shift+B` on Windows and Linux, `Cmd+Shift+B` on macOS) is Quick Entry's counterpart: a floating task list you can summon from anywhere. Check off tasks, edit them inline, move through them with the arrow keys, then dismiss it. Point it at any project, smart list or custom list in Settings; custom lists use exactly the same rules as in the main window, including the shared-work conditions.

Quick View rows have a round checkbox, the due date in words and the priority at the end, and follow your theme. It keeps working offline from its last fetch, with your queued changes laid over it.

## Natural language input

Type tasks the way you think. Vicu parses freeform text into structured fields as you type, highlights what it recognized, and suggests projects, labels and dates under the cursor. The chips above the field follow what you typed, unless you set them yourself.

| Token | Example | Effect |
|-------|---------|--------|
| Days | `today`, `tomorrow`, `friday`, `this friday`, `next Monday`, `next week`, `next month`, `in 3 days`, `in 2 weeks` | Sets the due date (date only) |
| Calendar dates | `jan 15`, `15 jan`, `march 3rd`, `2026-10-15`, `10/15` | Sets the due date; a date that has already passed this year means next year |
| Times | `tomorrow 3pm`, `friday 3pm`, `today at 14:00`, `in 2 hours`, `at 5pm` | Sets due date and time |
| `!` | `Buy milk !`, `! Buy milk` | Due today |
| Priority | `p1`–`p4`, `!urgent` (or `!critical`), `!high`, `!medium` (or `!med`), `!low` | Sets priority |
| Labels | `@shopping`, `@"grocery list"` | Applies labels |
| Projects | `#work`, `#"side project"` | Assigns to project |
| Recurrence | `every 3 days`, `every Monday`, `daily`, `weekly`, `monthly`, `biweekly` | Sets the repeat interval |
| Places | `when I get home`, `when I arrive at work`, `when I leave work` | Location reminder at a place your phone saved |

Everything that isn't a recognized token becomes the task title. Tokens can appear anywhere in the input and are shown as dismissible chips.

A few rules that keep titles intact:

- A date without a time is a date only (due at the end of that day). A time without a date means today if it is still ahead, otherwise tomorrow.
- A bare weekday is the next one on or after today; `next <weekday>` is that day in the following week (weeks start on Monday).
- Connector words go with the date: "Submit report by friday" becomes "Submit report".
- Words about the past ("last friday", "yesterday"), a date inside another word ("Monday's") and "weekend" are not read as dates. A range uses its first date ("Trip friday to sunday" is due Friday).
- `daily`, `weekly` and friends only make a task recurring as the last word: "Water plants daily" repeats, "weekly standup" stays a title.
- An explicit date wins over `!`, and a label or project in the middle of a date does not break it ("Call tomorrow @home 3pm").

Two syntax modes are available in **Settings, General, Task Parser**: **Todoist** (default; `@` for labels, `#` for projects) and **Vikunja** (`*` for labels, `+` for projects). The parser is shared with the mobile app and both are tested against the same corpus ([`shared-parser-spec.md`](shared-parser-spec.md), [`test-fixtures/nlp-corpus-v1.json`](test-fixtures/nlp-corpus-v1.json)).

## Organize your work

### Smart lists

| List | What it shows |
|------|---------------|
| **Inbox** | Your Inbox project: where new tasks land. Sort it with the button in its header |
| **Today** | Due today, plus an Overdue section, plus your routines for the day |
| **Upcoming** | Due from tomorrow on, grouped by day |
| **Anytime** | Every open task outside the Inbox |
| **Logbook** | Completed tasks, grouped by the day you completed them, newest first; older ones load on request |

Today, Upcoming and Overdue follow your local calendar day, also late in the evening and in time zones far from UTC, and roll over at midnight by themselves. Each smart list has its own icon and colour in the sidebar.

### Projects and areas

- The sidebar shows **areas** (top-level projects) with their projects below, collapsible, each with a **progress ring** of how much is done. **Show task count** adds the number of open tasks; both are options under **Settings, Projects, Display**.
- **One project menu** everywhere: the **…** button in the sidebar, right-click, the project's page header and Settings. It has **Rename**, **Edit…** (name, parent, colour), **Add subproject**, **Move to…**, **Sort tasks**, **Set as Inbox**, **Share…**, **Review**, **Archive** and **Delete**.
- **Drag projects** onto another to put them inside, towards the top or bottom edge of a row to place them before or after, or onto the **Projects** header to make them top level. A move to another parent offers **Undo**.
- Add a project right in the sidebar with the **+** next to Projects; renaming happens in place too.
- Archived projects sit in a collapsed **Archived** group with **Restore**.
- **Sections** split a project into groups with their own headers and counts. Add one from the project menu or between sections.

### Task order

Each project can be sorted its own way: **Due date, then manual** (the default), **Due date, then priority**, **Manual**, **Priority**, **Title**, **Newest first** or **Oldest first**. Set an order for every project in **Settings, Projects, Display**, or for one project with **Sort tasks** in its menu; a project without its own order follows its parent's. The order syncs with your other devices.

In Manual order you can drag every task; in the default order the undated ones; in the sorted orders none. `Alt+Shift+Up/Down` (`Option+Shift` on a Mac) and **Move up** / **Move down** in a task's context menu follow the same rule. Today, Upcoming, Anytime and custom lists keep their own order.

### Custom lists

Build your own filtered views and pin them to the sidebar. A custom list can filter on:

- **Projects** (include or exclude) and **labels**
- **Due date window**: overdue, today, this week, this month, has a due date, no due date; today, this week and this month have an **Include overdue tasks** option
- **Priority**
- **Changed**: today, or in the last 3, 7 or 30 days
- **Shared work**: **Assigned** (to me, to someone else, to nobody), **Comments** (unread, has comments) and **Only tasks in shared projects**

and sort by due date, created, updated, priority, title, completed or position. Lists are stored on your Vikunja server, so the mobile app shows the same lists with the same results, and Quick View can show any of them.

### Labels

Labels have custom colours, with chip text that is always readable on the colour. Drag a task onto a label in the sidebar to apply it; each label has its own page.

### Routines

Routines are recurring habits that live next to your tasks: a name, one or more times a day (each with **Remind me** and **Follow up**) and a schedule (daily, weekdays, every few weeks, or a number of days after you last completed it). Today lists the routines still open for the day; complete or skip them there. A missed day is "Not logged"; routines are never overdue.

The Routines view shows each routine's history and exports it to CSV. History older than 400 days moves to hidden archive tasks on your server and stays available. Routines are optional: **Settings, General, Routines** has **Enable routines** and **Show routines in Today**.

### Project review

Step through your projects on a cadence to keep them current. **Review** shows which projects are due ("Not reviewed yet" in grey, "Due" in amber), and you can mark one reviewed, change its cadence, or exclude it from review from its menu. The review status is stored on the server and matches the mobile app.

## Working with tasks

- **The task card**: open a task and it grows from its row into a card. Properties that are set show as chips (date, project, labels, priority, repeat, reminders, assignees); unset ones wait as quiet buttons.
- **The When panel**: one panel for every date and time. Type a date in your own words and watch the calendar follow, pick a quick choice (the coming weekdays are listed by name), move through the month grid with the arrow keys, Home, End and Page Up/Down, and add a time.
- **Dates read the same way everywhere**: "Today", "Tomorrow", weekdays, then dates, in your system's regional format, with the year only when it is not this one. **Settings, General, Appearance, Clock** picks System, 12-hour or 24-hour.
- **Notes** with rich text and links (web, email and `obsidian://`), and pasted images.
- **Subtasks** nested under their parent, with their own checkboxes.
- **Attachments**: drag and drop or browse. Open or **Save** each one. Programs and scripts are revealed in the file manager instead of run.
- **Recurring tasks**: daily, weekly, monthly or any interval. Completing one moves it to the next date; Undo puts its dates back.
- **Priority** shows as one to three bars (low, medium, high) and a filled square for urgent, with the name on hover and for screen readers.
- **Completing a task**: the checkbox pops, a check is drawn and the title is struck through. The row stays for 5 seconds (longer while you point at it or it has focus) so you can change your mind, then collapses. One **Completed** message with **Undo** covers a run of completions ("3 completed").
- **Several tasks at once**: select two or more and a bar appears to schedule, complete, move, tag or delete them together.
- **Quick find** at the top of the sidebar (`Ctrl+F`, `Cmd+F`) shows matching tasks as you type; Search also looks in completed tasks.
- **Command palette** (`Ctrl+Shift+P`, `Cmd+Shift+P`) to jump to any list or run any command without the mouse.
- **Drag and drop** to reorder tasks, move them to another project, label them, and reorder projects and custom lists.
- **Refresh** with `F5` (or `Ctrl+R`, `Cmd+R`, View, Refresh) reads the page again from the server, including projects, labels, sharing, custom lists and settings changed on another device.
- **Print** a list with `Ctrl+P` (`Cmd+P`).
- An optional **completion sound**.

## Reminders

- **Per-task reminders** at a set time, or relative to the due, start or end date.
- **Default reminder** (**Settings, Notifications**): every new task with a due date gets it, whether made in the composer, Quick Entry, by voice or by pasting. A reminder you pick yourself wins, and changing the date of an existing task never adds one.
- **Location reminders**: the reminder popover has an **At a place** section listing the places your phones saved (Home, Work, ...). Choose **When I arrive** or **When I leave**, within 100, 200 or 500 m, and your phone reminds you there. The chip reads "Arrive: Home". Places are set up on a phone and listed in **Settings, Notifications, Places**; where a place is never leaves the phone.
- **Daily reminders**: **Scheduled Reminders** sends a daily summary of overdue, due today and upcoming tasks at a time you choose, with an optional second time.
- Notifications open the task in the main window when you click them.

## Share projects with others

Share a project with the people you live or work with. Everything below appears only on projects someone else can see; if you share nothing, Vicu looks and works exactly as before.

- **Share**: choose **Share…** in a project's menu, type a username and pick **Can view**, **Can edit** or **Admin**. Change access or remove someone in the same dialog (with **Undo**). Only admins can share, and sharing a project shares its subprojects. A shared project has a people icon in the sidebar.
- **Assign**: rows show who is assigned, you first. The open task's **Assign** chip lets you tick people; Vikunja notifies them.
- **Comments**: rows show the comment count, with a dot for unread ones. Open the comments pane beside the list from the count, the **Comments** button or `Ctrl+Shift+C` (`Cmd+Shift+C`). Type `@` to mention someone, `Ctrl+Enter` to post, edit or delete your own comments, and **Notify me** to follow the task. Opening a thread marks it read on every device.
- **Custom lists for shared work**: Assigned to me, Waiting on others, Unread comments, Changed this week (see [Custom lists](#custom-lists)).
- **Offline**: assignments and comments made offline wait in the queue; a comment still waiting says **Waiting to sync**.

The people you share with need an account on the same Vikunja server. If you sign in with an API token, give it the permissions for task comments, task assignees and project sharing in Vikunja; Vicu tells you which one is missing. **Notify me** needs a password or single sign-on sign-in, because Vikunja does not let API tokens follow tasks.

## Obsidian and browser links

### Obsidian

When Quick Entry opens, Vicu detects your active Obsidian note through the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin. Press `Ctrl+L` to attach it. The link uses [Advanced URI](https://github.com/Vinzent03/obsidian-advanced-uri) with a frontmatter `uid`, so it survives note renames. Vicu adds the `uid` property to a note only when you save a task linked to it; notes you do not link are never changed. Linked tasks show a clickable Obsidian icon in task lists, in Quick View, everywhere; click it and the note opens.

Three modes: **ask** (`Ctrl+L` to opt in per task), **always** (auto-link) and **off** (zero overhead). Windows and macOS.

### Browser

Vicu can link a task to your active browser tab. A bundled Manifest V3 extension (Chrome, Edge, Brave, Vivaldi, Chromium and Firefox) sends the tab's title and URL to Quick Entry through native messaging. The bridge runs on Vicu's own runtime, so Node.js does not need to be installed. Without the extension, Vicu falls back to reading the address bar (UI Automation on Windows, AppleScript on macOS).

Same three modes: **ask** (`Ctrl+L`), **always** and **off**.

<p align="center">
  <img width="718" height="261" src="https://github.com/user-attachments/assets/31293b9f-2ce5-4b3c-bf9e-c7ea9fd8702b">
</p>

## Sync, offline and your other devices

- **Works offline.** When the server is unreachable you keep working: creating, editing, completing and deleting tasks, labels, pasted images, assignments and comments, in the main window, Quick Entry and Quick View, are queued and sent in order when the connection is back. The last task lists are kept, so the app also starts offline.
- **Sync panel.** The sync button in the sidebar shows pending and failed changes, with retry and discard, and custom-list and settings changes the server does not have yet, with **Sync now** and **Discard**. A stopped sync retries after 5 seconds, 15 seconds, then every minute.
- **Your edits never overwrite another device.** Vicu sends only the fields you changed, so editing a task on your PC does not revert what you changed on your phone a moment ago. Changes are sent one at a time, so bulk actions also work on Vikunja servers that use SQLite.
- **Settings that follow you**: the **Inbox** project, the **task order** of every project, your **custom lists**, saved **places** and location reminders are the same in the desktop app and on every phone, iPhone and iPad. Device choices such as the theme, hotkeys and Quick Entry stay on each device.
- **Same rules on desktop and mobile.** Due dates, days and weeks, custom lists, review status, quick-add parsing, routines, task order and collaboration follow one shared specification ([`docs/cross-app-semantics-v1.md`](docs/cross-app-semantics-v1.md)), and both apps run the same test fixtures, so the same task means the same thing everywhere.
- **Fresh without asking**: lists refresh when the window gets focus, every 5 minutes while visible, after sleep and at midnight.
- **Signing out** first tries to send waiting changes and asks before signing out when something has not reached the server. A different user signing in on the same server starts clean.

**Hidden tasks.** Vikunja has no place for an app's own data, so Vicu keeps custom lists, routines (and their archive) and synced settings in tasks it marks done and hides from every list, count, reminder and search. You may see them in other Vikunja apps (for example "Vicu preferences (sync metadata — do not delete)"); leave them in place. Each person's Vicu uses only the hidden tasks they created, so a shared Inbox never mixes people's data.

## Look and feel

- **One design system with the mobile app**: the same colours, type, spacing, corner radii, date wording and motion, from one token file shared byte for byte. Every colour pair is checked for readable contrast in light and dark.
- **Light, dark and system themes.**
- **Motion with a purpose**: a task opens into its card and closes back into its row, views fade with a small rise, lists slide when rows are added, moved or completed, and counts roll. When your system asks for reduced motion, all of it becomes a plain fade.
- **Windows**: native caption buttons with Snap Layouts, the Mica material behind the sidebar on Windows 11 22H2 and later, and Segoe UI Variable.
- **macOS**: native traffic lights and a translucent sidebar.
- **Linux**: a frameless window with Vicu's own window controls.
- **Accessibility**: one clear focus ring, 24 px targets, real menus, dialogs and listboxes with arrow keys, typeahead and Escape, task rows with arrow-key navigation, polite announcements for completions and messages, and full support for Windows contrast themes (forced colours), also in Quick Entry and Quick View.
- **System tray**: open any window from the tray. **Launch on startup** on Windows, macOS and Linux, with **Start hidden** to stay in the tray at login.

## Keyboard shortcuts

`Ctrl` is `Cmd` on macOS. The full list is in **Settings, Keyboard Shortcuts**.

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+V` (`Cmd+Shift+Space` on macOS) | Quick Entry, from any app (once turned on) |
| `Alt+Shift+B` (`Cmd+Shift+B` on macOS) | Quick View, from any app (once turned on) |
| Your voice shortcut | Hold to say a task, tap to keep listening |
| `Ctrl+N` | New task |
| `Ctrl+V` | New task from the clipboard |
| `Ctrl+F` | Quick find |
| `Ctrl+Shift+P` | Command palette |
| `Up` / `Down` | Move between tasks |
| `Enter` | Open the task |
| `Space` | Complete the focused task and move to the next |
| `Ctrl+K` | Complete the selected task |
| `Ctrl+T` | Due today |
| `Alt+Shift+Up/Down` | Move the task up or down (Manual order) |
| `Escape` / `Ctrl+Enter` | Save and close the open task |
| `Ctrl+Shift+C` | Show or hide comments (shared projects) |
| `Ctrl+L` | Link the Obsidian note or browser tab (Quick Entry) |
| `F2` / `Shift+F10` | Rename a project / open its menu (sidebar) |
| `Alt+Shift+Arrows` | Move a project up, down, in or out (sidebar) |
| `F5` or `Ctrl+R` | Refresh from the server |
| `Ctrl+Shift+R` | Reload the window |
| `Ctrl+P` | Print |

## Vicu vs the official Vikunja app

The [official Vikunja frontend](https://vikunja.io/) is a full project management suite: Kanban, Gantt, table views, teams, dependencies and more. Vicu is a personal task manager that trades all of that for speed and simplicity, with just enough sharing for a household or a small team. Both talk to the same backend, so you can use them side by side.

## Getting started

### Requirements

- A [Vikunja](https://vikunja.io/) server you can reach: your own or [Vikunja Cloud](https://vikunja.cloud/). Vicu is built and tested against **Vikunja 2.4.0**; use that or newer (the mobile app requires it).
- Windows 10 or 11 (x64), macOS 13 Ventura or later (Apple Silicon), or a Linux desktop (x64 or arm64).

### Download

| Platform | Format |
|----------|--------|
| Windows  | `.exe` (NSIS installer, x64) |
| macOS    | `.dmg` (Apple Silicon) |
| Linux    | `.AppImage` (x64, arm64) |

Grab the latest installer from [GitHub Releases](https://github.com/rendyhd/Vicu/releases). Vicu checks for updates every 12 hours and tells you when one is out.

### Windows

Run the installer. The Windows build is not code-signed, so SmartScreen may ask you to confirm with **More info, Run anyway**.

### macOS

Open the `.dmg`, drag **Vicu** into **Applications** and launch it. The app is signed with an Apple Developer ID and notarized, so it opens normally; macOS may show a one-time "downloaded from the internet" prompt on first launch. Voice input asks for microphone and speech recognition access the first time you use it.

### Linux (AppImage)

Make the AppImage executable before running it:

```bash
chmod +x Vicu-*.AppImage
```

```bash
./Vicu-*.AppImage
```

A few platform notes:

- **Global hotkeys on Wayland**: Electron binds shortcuts through the GlobalShortcuts portal. Accept the consent dialog if your desktop shows one (GNOME). If registration still fails, Settings, Quick Entry / View shows a warning with copyable commands: bind those in your desktop's keyboard settings, or open Quick Entry and Quick View from the tray. On X11, hotkeys work as on Windows and macOS.
- **System tray**: works out of the box on KDE, XFCE, Cinnamon and most Wayland compositors. On GNOME you need the **AppIndicator and KStatusNotifierItem Support** extension.
- **Browser links**: supported through the bundled extension and native messaging. Turn it on in Settings and click **Register browser hosts**; the manifests are written to `~/.config/<browser>/NativeMessagingHosts/` and `~/.mozilla/native-messaging-hosts/`. The address-bar fallback is not available on Linux.
- **Not on Linux**: Obsidian note detection (the setting is visible, but no foreground-app detection runs) and voice input (hold + opens the composer instead).
- **Launch on startup** writes an XDG autostart entry (`~/.config/autostart/com.rendyhd.vicu.desktop`) that runs the AppImage.

### Setup

1. Launch Vicu.
2. Enter your Vikunja server URL (for example `https://vikunja.example.com`).
3. Sign in with your **username and password** (with TOTP two-factor), **OpenID Connect** (single sign-on, with provider discovery and silent re-authentication) or an **API token**. Password and single sign-on also create a backup API token for this computer, which logging out revokes.
4. Pick a project to use as your **Inbox**. If another device already chose one, Vicu suggests it.
5. Turn on Quick Entry and Quick View and set their hotkeys in **Settings, Quick Entry / View**. Optionally set a voice shortcut, a default reminder, and the Obsidian and browser links.

Your settings and sign-in live in Vicu's profile folder. Set `VICU_USER_DATA_DIR` to a folder to run Vicu with a separate, throwaway profile.

## Building from source

Vicu is Electron + React + TypeScript + Tailwind CSS, with TanStack Router and Query. You need Node.js 22.12 or newer.

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the app with hot reload and DevTools |
| `npm test` | Run the test suite (vitest) |
| `npm run typecheck` | Type-check every tsconfig |
| `npm run verify` | Typecheck, tests and a production build; run before every commit |
| `npm run dist` / `dist:mac` / `dist:linux` | Package the Windows installer, macOS DMG or Linux AppImages |
| `npm run ui:verify` | Drive the built app against a seeded local Vikunja and capture screenshots ([`scripts/ui-verify/README.md`](scripts/ui-verify/README.md)) |

The architecture, conventions and release process are described in [`CLAUDE.md`](CLAUDE.md). The rules shared with the mobile app are in [`docs/cross-app-semantics-v1.md`](docs/cross-app-semantics-v1.md) and [`docs/design-system-v1.md`](docs/design-system-v1.md); change those only together with the mobile repository. Release notes for every version are in [`docs/releases/`](docs/releases/).

Found a bug or have an idea? [Open an issue](https://github.com/rendyhd/Vicu/issues).

## See also

- **[Vicu for Android and iOS](https://github.com/rendyhd/Vicu-Mobile)**: Vicu on your phone, iPhone and iPad, with widgets, share to Vicu, Siri and location reminders
- **[vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)**: a lightweight tray app with only Quick Entry and Quick View
- **[Vikunja](https://vikunja.io/)**: the open-source backend that powers Vicu

## License

[MIT](LICENSE)
