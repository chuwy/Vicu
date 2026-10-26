# The assistant (desktop)

Vicu can use a language model you choose to turn what you say or paste into tasks, and to answer
questions about your tasks. It is off until you set it up, and nothing is sent anywhere before you
agree to it. Vicu mobile has the same assistant and reads everything the same way; the rules both
apps follow are in `docs/ai-assistant-v1.md`.

## Setting it up

Settings, Assistant:

1. **Provider**: OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, Open WebUI, or any other
   server that speaks the OpenAI chat format. For Ollama, Open WebUI and "Other" you can change
   the address (Ollama's default is `http://localhost:11434/v1`).
2. **Key**: paste the provider's API key and press Save key. The key is kept encrypted on this
   computer, like your Vikunja sign-in; it is never synced to your other devices and never
   written to a log. Ollama needs no key.
3. **Models**: Load models lists what the provider offers; Vicu suggests one for dictation and one
   for Ask and Talk. Press **Test connection**: it checks that the model can give a structured
   answer (needed for dictation) and call a tool (needed for Ask).
4. Turn on **Smart dictation**, **Ask** and **Talk**. A switch stays off while the model it needs
   has not passed the test.

The first time something would be sent to a provider that is not on your own network, Vicu shows
what will be sent and asks you to agree. A server on your own computer or local network (Ollama,
Open WebUI) does not ask. An `http://` address that points outside your network gets a warning,
because the key and your text would travel unencrypted.

## Smart dictation

With Smart dictation on, voice input (hold +, the voice shortcut, or "Say a task" in the command
palette; see `docs/voice-input.md`) can hold several tasks at once: "Buy milk, call the plumber on
Friday about the leak, and book the dentist for next month". The words become **draft cards**, one
per task, with the title, notes, date and time, project, labels, priority, repeat, reminder and
steps the model read. Nothing is added until you press Add.

- Fix a card by hand, remove one with its close button, or hold the microphone again and say what
  to change ("make the first one Friday", "drop the dry cleaning"). Fields that changed are
  highlighted.
- Dates are checked by Vicu's own quick-add rules, so "Friday" means what it means when you type
  it. A value the model guessed, or one Vicu had to drop, is marked on the card.
- A new task goes to the project of the list you are in, else your Inbox, as a typed task would.
- **Make tasks from text** (command palette) does the same with text you paste, such as notes or
  an email.
- **Break into steps** (right-click a task) asks the model for the steps of that task and adds
  them as subtasks after you check them.
- If a request fails (no connection, the model did not answer), the transcript is kept, also
  across a restart, so you can try again or add it as one plain task.

## Ask and Talk

Press Mod+J (Cmd+J on a Mac, Ctrl+J elsewhere) or choose "Ask Vicu" in the command palette. Ask
answers questions about your tasks ("what is overdue in Work?", "what did I finish last week?") by
looking them up through a few read-only tools; tasks it mentions show as rows you can open or
check off.

Ask never changes anything by itself. When you ask it to add, change or complete tasks, it shows a
card with each task and its new values; you apply or decline it. Applying shows one message with
Undo. Notes are only ever added to, never replaced. A change to more than 20 tasks asks twice.

**Talk** is Ask by voice: hold the microphone in the Ask pane, speak, and the answer is read
aloud with the system voice. While a card is open you can answer "yes" or "no" out loud; anything
else is sent as your next message.

Text from shared projects (titles, notes, other people's names) is treated as data, never as an
instruction to the model, and the model cannot reach the internet or fetch images or links.

## Speech on this computer

Voice input normally uses the system's recogniser. Under Speech on this computer you can download
a speech model (from about 60 MB to about 870 MB; larger ones are more accurate) so that speech is
recognised on this computer, offline, with the names of your projects and labels as hints. Audio
never leaves the computer: only the recognised text goes to the provider. Downloads can be paused
and resumed, and a model can be deleted again.

## What stays where

- Sent to the provider: for dictation, the words (never audio) with the names of your projects,
  labels and places and today's date and time; for Ask, your messages and what its tools look up.
- On this computer only: the last five conversations and any transcript kept after a failed
  request. They are deleted when you sign out, or with Delete conversations in Settings,
  Assistant, Privacy.
- The assistant's settings and key belong to this computer, not to your Vikunja account: they are
  not synced and stay when you sign out.
