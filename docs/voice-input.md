# Adding tasks by voice (desktop)

Say a task instead of typing it: "Call mom tomorrow 3pm #Family @phone" becomes "Call mom", due
tomorrow at 15:00, in the Family project, with the label phone. The words are read like quick add
(the one parser in `src/renderer/lib/task-parser/`, the composer's field rules), so the syntax,
the `!` today shortcut and the parser settings are the same as when typing. Android and iOS have
their own voice paths (the `vicu-android` repo, `docs/voice-input.md` there); the reading of the
text is the same.

## Starting it

- **Hold +.** Press and hold the + of a list (the header button or the "New task" row) for 400 ms.
  A card rises from the bottom of the window with a pulsing microphone and the words as they are
  recognized, the parsed parts highlighted in the quick-add colours (date green, priority red,
  label orange, project blue, repeat purple) and shown as chips under the text. Let go to add the
  task, press Esc to cancel, or move the pointer well away (60 px down or 140 px in any
  direction) and let go there to cancel; moving back undoes that. A plain click on + opens the
  composer exactly as before: the hold is decided by `lib/voice/press-gesture.ts` (a press that
  moves more than 8 px before 400 ms stays a click; the click after a hold is swallowed).
- **The voice shortcut.** Settings, Keyboard Shortcuts, Voice input (config `voice_hotkey`). It is
  off until the user records one: there is no default combination, the field says "Not set", and
  Clear turns it off again. Hold it while Vicu is in front to talk and let go to add (push to
  talk). Tap it instead (released within 300 ms) and listening stays on until the shortcut is
  pressed again, Enter, or the card's Add button; Esc cancels. Letting go of any key of the
  combination ends a hold, because macOS does not send the key-up of a letter while Command is
  down. `lib/voice/shortcut-hold.ts` is the state machine, `hooks/use-voice-shortcut.ts` feeds it
  window key events. Settings warns when the combination is also an enabled Quick Entry or Quick
  View hotkey or one of the app's own shortcuts (`lib/voice/shortcut-conflicts.ts`).
- **"Say a task"** in the command palette starts listening without holding anything (the same as
  a tapped shortcut). Together with the tap this is the accessible way in: nothing needs a held
  pointer or held keys, and the + keeps its name "New task".

The shortcut is not global. Electron's `globalShortcut` reports only the key press, never its
release, so holding cannot work while another app is in front; the Quick Entry and Quick View
hotkeys stay the global ones. A global "tap to talk" in the Quick Entry window is a possible
later step.

## Adding the task

`lib/voice/voice-task.ts` turns the final words into a task: the parser with the user's settings
and the composer's `resolveComposerFields` with nothing picked by hand. The task gets the same
defaults as the composer of the list on screen, however the capture was started (+, the shortcut
or the palette): the `TaskList` that shows a composer registers the `projectId` and
`defaultDueDate` its view already gives the composer (`stores/voice-list-store.ts`), and the
capture reads them once when it starts. So a project view puts the task in that project, Today
gives it today's date, a custom list uses its add-to project, and Inbox, Upcoming, Anytime and a
tag add to the Inbox without a date (the same as Android). The words win over those defaults (a
project or date they name), as in the composer. A list project that is gone or archived falls back
to the Inbox, and so does a screen without a composer (Search, Settings). The card shows the
list's project and date as chips before anything is said (no chip for the Inbox), replaced by what
the words name. Labels are matched by name or created, and the default reminder (Settings,
Notifications, Default reminder) is added when there is a due date. A trailing full stop from the
recognizer is dropped.
`hooks/use-add-voice-task.ts` creates it through the composer's create (`useCreateTask`), so it
is queued with its labels when the server cannot be reached, and a toast says what was added:
`Added “Call mom”, tomorrow, 15:00` or `Added “Report” to Work` (the date is the row phrase of
`date-display.ts`). Nothing heard, or only a date, adds nothing and says so.

## Engines

The window talks to one small interface (`lib/voice/recognizer.ts`: availability, start, partial,
final, stop, cancel). Main runs one listening session at a time (`src/main/voice/service.ts`,
IPC `voice:availability`, `voice:start`, `voice:stop`, `voice:cancel`, events `voice:event`)
through a helper process that writes JSON lines on stdout and reads `stop` / `cancel` on stdin
(`src/main/voice/helper-protocol.ts`, `helper-session.ts`: a helper that does not answer `stop`
within 4 s ends with what was heard so far).

| Platform | Engine | Notes |
|---|---|---|
| macOS | Apple's speech recognizer (`SFSpeechRecognizer`) in a small Swift helper, `native/voice-macos/VicuSpeech.swift`, built by `npm run voice:helper` into `resources/voice/vicu-speech-macos` (universal, git-ignored; `dist:mac` builds it before packaging) | Live partial words. Recognized on the Mac (`requiresOnDeviceRecognition`) when the language supports it, otherwise by Apple's servers (Settings says which). Uses the system language. An utterance ends after 55 s. |
| Windows | The Windows desktop recognizer (`System.Speech`, offline, no account) in `resources/voice/voice-windows.ps1`, run with Windows PowerShell | Live partial words (hypotheses). Needs a speech recognizer for the Windows display language (Settings, Time & language, Speech); English is usually present, many other languages are not. Accuracy is below Apple's or the cloud services'. PowerShell takes about a second to start. |
| Linux | None | Holding + or the shortcut says "Voice input is not available on this system" and opens the composer instead. |

Chromium's Web Speech API (`webkitSpeechRecognition`) is not used: Chromium sends the audio to a
Google service with keys that only Google Chrome builds carry, so in Electron it ends with a
`network` error. An in-window model (Whisper through transformers.js) would work everywhere but
adds a download of tens to hundreds of megabytes and gives no live words on most machines.

### Permissions

Nothing is asked at start-up. On macOS the first use asks for the microphone
(`systemPreferences.askForMediaAccess`, from main) and the helper then asks for speech
recognition; the usage strings are in `electron-builder.yml` (`mac.extendInfo`) and, for the
helper itself, in `native/voice-macos/Info.plist` (linked into the binary). The hardened runtime
needs `com.apple.security.device.audio-input` (`build/entitlements.mac.plist`, also the
inherited entitlements the helper is signed with). A refusal ends the capture with a message
naming the System Settings pane. On Windows the microphone follows Settings, Privacy & security,
Microphone, "Let desktop apps access your microphone".

In development (`npm run dev`) macOS attributes the permissions to Electron.app, whose
Info.plist has no speech recognition usage string; voice input is meant to be tried in a
packaged build (`npm run voice:helper && npx electron-builder --mac --dir`).

## Tests

`lib/voice/__tests__/` (the press gesture, the shortcut hold, the text-to-task mapping and
confirmation, the recognizer's session handling, the shortcut conflicts),
`lib/__tests__/accelerator.test.ts` and `src/main/__tests__/voice-helper.test.ts` (the line
protocol and the helper session with a fake process). The helpers themselves are not run in
tests; `vicu-speech-macos --check` prints availability without asking for anything.
