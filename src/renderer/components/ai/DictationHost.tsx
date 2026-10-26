import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Loader2, Mic, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { cn } from '@/lib/cn'
import { useAiWorkspace } from '@/hooks/use-ai'
import { useAddVoiceTask } from '@/hooks/use-add-voice-task'
import { useDateFormat } from '@/hooks/use-date-format'
import { useDeleteTask } from '@/hooks/use-task-mutations'
import { useAddDrafts } from '@/hooks/use-add-drafts'
import { api } from '@/lib/api'
import { appRecognizer } from '@/lib/ai/recognizers'
import { contextProjects, pathOf } from '@/lib/ai/workspace'
import { formatDateChip } from '@/lib/date-utils'
import { UNDO_TOAST_MS, toast, useToastStore } from '@/stores/toast-store'
import { setDictationDeps, useDictationStore, type DraftCard } from '@/stores/dictation-store'
import { instantOfLocal, type CheckedDraft } from '../../../shared/ai/dictation'
import type { DraftField } from '../../../shared/ai/contract'
import type { Task } from '@/lib/vikunja-types'

const FIELD_NAMES: Record<string, string> = {
  task: 'task',
  title: 'title',
  notes: 'notes',
  when: 'date',
  project: 'project',
  labels: 'labels',
  priority: 'priority',
  repeat: 'repeat',
  reminder: 'reminder',
  place: 'place',
  subtasks: 'subtasks',
}

const PRIORITIES = [
  { value: 0, label: 'No priority' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

function droppedValue(value: unknown): string {
  if (typeof value === 'string') return `“${value}”`
  if (value === null || value === undefined) return 'nothing'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Smart dictation's draft cards (docs/ai-assistant-v1.md section 4): what the model made of the
 * words, checked, editable by hand and by voice, added in one go. Mounted once, in AppShell. Also
 * shows a transcript kept after a failed request (4.6) when the app starts.
 */
export function DictationHost() {
  const phase = useDictationStore((s) => s.phase)
  const ws = useAiWorkspace()
  const wsRef = useRef(ws)
  wsRef.current = ws

  useEffect(() => {
    setDictationDeps({ workspace: () => wsRef.current, locale: () => navigator.language })
    return () => setDictationDeps(null)
  }, [])

  // A transcript kept after a failed request comes back when the app starts (4.6).
  useEffect(() => {
    let cancelled = false
    void window.api.ai.getKeptTranscripts().then((kept) => {
      const first = kept[0]
      if (cancelled || !first || useDictationStore.getState().phase !== 'idle') return
      useDictationStore.setState({
        phase: 'failed',
        source: 'voice',
        transcript: first.transcript,
        reference: first.reference,
        list: first.list ? { name: first.list.name, projectId: first.list.projectId, defaultDue: first.list.defaultDue } : null,
        parent: null,
        cards: [],
        unclear: [],
        error: first.error,
        keptId: first.id,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (phase === 'idle') return null
  return <DictationPanel />
}

function DictationPanel() {
  const state = useDictationStore()
  const { phase, cards, unclear, transcript, error, source, parent, edit } = state
  const ws = useAiWorkspace()
  const addDraftsNow = useAddDrafts()
  const deleteTask = useDeleteTask()
  const addVoiceTask = useAddVoiceTask()
  const panelRef = useRef<HTMLElement>(null)

  const close = useCallback((discard = true) => useDictationStore.getState().close({ discard }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return
      event.preventDefault()
      // A kept transcript stays unless the user discards it on purpose.
      close(useDictationStore.getState().phase !== 'failed')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const addAll = async () => {
    const drafts = useDictationStore.getState().cards.map((card) => card.draft)
    if (drafts.length === 0) return
    useDictationStore.getState().setPhase('adding')
    let parentTask: Task | null = null
    if (parent) {
      const fetched = await api.fetchTaskById(parent.id).catch(() => null)
      parentTask = fetched && fetched.success ? fetched.data : ({ id: parent.id, title: parent.title, project_id: parent.project_id } as Task)
    }
    try {
      const result = await addDraftsNow(drafts, parentTask)
      close(true)
      for (const problem of result.problems) toast.error(problem)
      const count = result.tasks.length
      useToastStore.getState().push('success', count === 1 ? 'Added 1 task' : `Added ${count} tasks`, {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: 'Undo',
          onAction: () => {
            void (async () => {
              for (const task of [...result.created].reverse()) {
                await deleteTask.mutateAsync({ task, deleteSubtasks: false }).catch(() => {})
              }
            })()
          },
        },
      })
    } catch {
      // The create failed with the app's usual error toast; the cards stay to try again.
      useDictationStore.getState().setPhase('cards')
    }
  }

  const addAsOneTask = async () => {
    const list = useDictationStore.getState().list
    const added = await addVoiceTask(transcript, list ? {
      projectId: list.projectId,
      defaultDueDate: list.defaultDue ? instantOfLocal(`${list.defaultDue}T12:00:00`) : null,
    } : null)
    if (added) close(true)
  }

  const heading = source === 'steps' && parent
    ? `Steps for “${parent.title}”`
    : phase === 'requesting' ? 'Making tasks…'
    : phase === 'failed' ? 'The tasks could not be made'
    : phase === 'empty' ? 'Nothing to add'
    : cards.length === 1 ? '1 task' : `${cards.length} tasks`

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] flex justify-center px-4">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Dictated tasks"
        data-dictation-panel=""
        data-phase={phase}
        className="vicu-voice-card pointer-events-auto flex max-h-[72vh] w-full max-w-xl flex-col rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg"
      >
        <header className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <Sparkles className="h-4 w-4 text-accent-blue" aria-hidden="true" />
          <h2 className="flex-1 text-card-title text-[var(--text-primary)]">{heading}</h2>
          {phase === 'cards' && <EditByVoiceButton />}
          <button
            type="button"
            aria-label="Close"
            onClick={() => close(phase !== 'failed')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {phase === 'requesting' && (
            <div className="flex items-start gap-2 text-meta text-[var(--text-secondary)]" role="status">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              <p className="break-words">{transcript}</p>
            </div>
          )}

          {(phase === 'failed' || phase === 'empty') && (
            <div className="space-y-2">
              {phase === 'failed' && error && <p className="text-meta text-danger" role="alert">{error}</p>}
              {phase === 'empty' && <p className="text-meta text-[var(--text-secondary)]">The model found no tasks in what you said.</p>}
              <blockquote className="whitespace-pre-wrap break-words rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-task-title text-[var(--text-primary)]">
                {transcript}
              </blockquote>
              {unclear.length > 0 && <UnclearNotes notes={unclear} />}
            </div>
          )}

          {(phase === 'cards' || phase === 'adding') && (
            <div className="space-y-3">
              {edit.phase !== 'idle' && (
                <p className="flex items-center gap-2 text-meta text-[var(--text-secondary)]" role="status">
                  {edit.phase === 'requesting' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                  <span>{edit.words || 'Say what to change…'}</span>
                </p>
              )}
              {edit.error && <p className="text-meta text-danger" role="alert">{edit.error}</p>}
              <ul className="space-y-2" aria-label="Tasks to add">
                {cards.map((card) => (
                  <li key={card.draft.ref}>
                    <DraftCardView card={card} disabled={phase === 'adding'} ws={ws} />
                  </li>
                ))}
              </ul>
              {unclear.length > 0 && <UnclearNotes notes={unclear} />}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-color)] px-4 py-3">
          {(phase === 'failed' || phase === 'empty') && (
            <>
              <Button variant="quiet" danger onClick={() => close(true)}>Discard</Button>
              <Button variant="secondary" onClick={() => void addAsOneTask()}>Add as one task</Button>
              <Button variant="primary" onClick={() => useDictationStore.getState().retry()}>Retry</Button>
            </>
          )}
          {phase === 'requesting' && <Button variant="quiet" onClick={() => close(true)}>Cancel</Button>}
          {(phase === 'cards' || phase === 'adding') && (
            <>
              <Button variant="quiet" onClick={() => close(true)}>Cancel</Button>
              <Button variant="primary" disabled={phase === 'adding' || cards.length === 0} onClick={() => void addAll()}>
                {phase === 'adding' ? 'Adding…' : cards.length === 1 ? 'Add task' : `Add ${cards.length} tasks`}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

function UnclearNotes({ notes }: { notes: readonly string[] }) {
  return (
    <div className="rounded-control border border-[var(--border-color)] px-3 py-2">
      <p className="text-caption font-medium text-[var(--text-secondary)]">Not placed</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-meta text-[var(--text-primary)]">
        {notes.map((note, i) => <li key={i}>{note}</li>)}
      </ul>
    </div>
  )
}

/** Holding the microphone with cards on screen records an instruction about them (4.4); a click latches. */
function EditByVoiceButton() {
  const edit = useDictationStore((s) => s.edit)
  const listening = edit.phase === 'listening'
  const heldRef = useRef(false)
  const startedAt = useRef(0)

  const start = () => {
    if (useDictationStore.getState().edit.phase !== 'idle') return
    startedAt.current = Date.now()
    useDictationStore.getState().setEditListening('')
    void appRecognizer().start({
      onReady: () => {},
      onPartial: (text) => useDictationStore.getState().setEditListening(text),
      onFinal: (text) => useDictationStore.getState().editByVoice(text),
      onError: (_code, message) => {
        useDictationStore.getState().setEditListening(null)
        toast.error(message || 'Voice input stopped.')
      },
    })
  }

  return (
    <button
      type="button"
      aria-pressed={listening}
      aria-label={listening ? 'Stop and change the tasks' : 'Change the tasks by voice'}
      title="Hold to change the tasks by voice"
      disabled={edit.phase === 'requesting'}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        heldRef.current = true
        if (!listening) start()
      }}
      onPointerUp={() => {
        if (!heldRef.current) return
        heldRef.current = false
        // A short press latches: listening goes on until the next click.
        if (Date.now() - startedAt.current > 400) appRecognizer().stop()
      }}
      onClick={(event) => {
        // Pointer presses are handled above; a keyboard press (Enter, Space) toggles.
        if (event.detail !== 0) return
        if (listening) appRecognizer().stop()
        else start()
      }}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-meta font-medium',
        listening ? 'bg-accent-fill text-on-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <Mic className="h-4 w-4" aria-hidden="true" />
      {listening ? 'Listening' : 'Change'}
    </button>
  )
}

interface DraftCardProps {
  card: DraftCard
  disabled: boolean
  ws: ReturnType<typeof useAiWorkspace>
}

function DraftCardView({ card, disabled, ws }: DraftCardProps) {
  const { draft, changed, dropped } = card
  const update = (change: Partial<CheckedDraft>) => useDictationStore.getState().updateDraft(draft.ref, change)
  const fmt = useDateFormat()
  const guessed = (field: DraftField) => draft.guessed.includes(field)
  const highlight = (field: DraftField) => changed.includes(field)
  const projects = useMemo(() => contextProjects(ws), [ws])
  const [showNotes, setShowNotes] = useState(draft.notes !== '')
  const [labelText, setLabelText] = useState('')

  const fieldClass = (field: DraftField) => cn(
    'rounded-chip border px-2 py-0.5 text-chip',
    guessed(field) ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]',
    highlight(field) && 'ring-2 ring-accent-blue/40',
  )
  // The date only: the time has its own field next to it.
  const dueLabel = draft.due ? formatDateChip(instantOfLocal(draft.due), true, new Date(), fmt) : null
  const place = draft.place ? ws.places.find((p) => p.id === draft.place?.place_id) : undefined

  return (
    <article
      aria-label={draft.title}
      data-draft-ref={draft.ref}
      className={cn('rounded-card border border-[var(--border-color)] p-3', highlight('title') && 'ring-2 ring-accent-blue/40')}
    >
      <div className="flex items-start gap-2">
        <input
          aria-label="Title"
          value={draft.title}
          disabled={disabled}
          onChange={(e) => update({ title: e.target.value })}
          className={cn(
            'min-w-0 flex-1 rounded-control border bg-transparent px-2 py-1 text-task-title text-[var(--text-primary)]',
            guessed('title') ? 'border-dashed border-accent-blue' : 'border-transparent hover:border-[var(--border-color)]',
          )}
        />
        <button
          type="button"
          aria-label={`Remove “${draft.title}”`}
          disabled={disabled}
          onClick={() => useDictationStore.getState().removeDraft(draft.ref)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {showNotes ? (
        <textarea
          aria-label="Notes"
          value={draft.notes}
          disabled={disabled}
          rows={Math.min(4, Math.max(2, draft.notes.split('\n').length))}
          onChange={(e) => update({ notes: e.target.value })}
          className={cn(
            'mt-1 w-full resize-y rounded-control border bg-transparent px-2 py-1 text-meta text-[var(--text-primary)]',
            guessed('notes') ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]',
            highlight('notes') && 'ring-2 ring-accent-blue/40',
          )}
        />
      ) : (
        <button type="button" className="mt-1 text-caption text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setShowNotes(true)}>
          Add notes
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[var(--text-primary)]">
        <label className={cn(fieldClass('when'), 'inline-flex items-center gap-1')}>
          <span className="sr-only">Due date</span>
          <span aria-hidden="true">{dueLabel ?? 'No date'}</span>
          <input
            type="date"
            disabled={disabled}
            value={draft.due ? draft.due.slice(0, 10) : ''}
            onChange={(e) => {
              const date = e.target.value
              if (!date) update({ due: null, reminder: draft.reminder && 'before_due_minutes' in draft.reminder ? null : draft.reminder })
              else update({ due: draft.due && !draft.due.endsWith('T23:59:59') ? `${date}${draft.due.slice(10)}` : `${date}T23:59:59` })
            }}
            className="w-5 cursor-pointer bg-transparent text-chip opacity-60 [&::-webkit-datetime-edit]:hidden"
          />
        </label>
        {draft.due && (
          <label className={cn(fieldClass('when'), 'inline-flex items-center gap-1')}>
            <span className="text-[var(--text-secondary)]">Time</span>
            <input
              type="time"
              disabled={disabled}
              value={draft.due.endsWith('T23:59:59') ? '' : draft.due.slice(11, 16)}
              onChange={(e) => update({ due: e.target.value ? `${draft.due!.slice(0, 10)}T${e.target.value}:00` : `${draft.due!.slice(0, 10)}T23:59:59` })}
              className="bg-transparent text-chip"
            />
          </label>
        )}

        <label className={fieldClass('project')}>
          <span className="sr-only">Project</span>
          <select
            disabled={disabled}
            value={draft.project_id}
            onChange={(e) => update({ project_id: Number(e.target.value) })}
            className="max-w-[12rem] bg-transparent text-chip"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.path}</option>
            ))}
            {!projects.some((p) => p.id === draft.project_id) && <option value={draft.project_id}>{pathOf(ws, draft.project_id) || 'Inbox'}</option>}
          </select>
        </label>

        <label className={fieldClass('priority')}>
          <span className="sr-only">Priority</span>
          <select
            disabled={disabled}
            value={draft.priority ?? 0}
            onChange={(e) => update({ priority: Number(e.target.value) || null })}
            className="bg-transparent text-chip"
          >
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {draft.labels.map((label) => (
          <span key={label.title} className={cn(fieldClass('labels'), 'inline-flex items-center gap-1')}>
            #{label.title}{label.id === null && <span className="text-[var(--text-secondary)]"> (new)</span>}
            <button
              type="button"
              aria-label={`Remove label ${label.title}`}
              disabled={disabled}
              onClick={() => update({ labels: draft.labels.filter((l) => l !== label) })}
              className="text-[var(--text-secondary)] hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          aria-label="Add a label"
          placeholder="+ label"
          disabled={disabled}
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const name = labelText.trim().replace(/^[#@*+]/, '').trim()
            if (!name || draft.labels.some((l) => l.title.toLowerCase() === name.toLowerCase())) return
            const existing = ws.labels.find((l) => l.title.toLowerCase() === name.toLowerCase())
            update({ labels: [...draft.labels, existing ? { id: existing.id, title: existing.title } : { id: null, title: name }] })
            setLabelText('')
          }}
          className="w-20 rounded-chip border border-transparent bg-transparent px-2 py-0.5 text-chip hover:border-[var(--border-color)]"
        />

        {draft.repeat && (
          <span className={cn(fieldClass('repeat'), 'inline-flex items-center gap-1')}>
            Every {draft.repeat.every === 1 ? draft.repeat.unit : `${draft.repeat.every} ${draft.repeat.unit}s`}
            <button type="button" aria-label="Remove repeat" disabled={disabled} onClick={() => update({ repeat: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {draft.reminder && (
          <span className={cn(fieldClass('reminder'), 'inline-flex items-center gap-1')}>
            {'before_due_minutes' in draft.reminder
              ? `Remind ${draft.reminder.before_due_minutes} min before`
              : `Remind ${formatDateChip(instantOfLocal(draft.reminder.at), false, new Date(), fmt)}`}
            <button type="button" aria-label="Remove reminder" disabled={disabled} onClick={() => update({ reminder: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {draft.place && (
          <span className={cn(fieldClass('place'), 'inline-flex items-center gap-1')}>
            {draft.place.trigger === 'arrive' ? 'Arrive' : 'Leave'}: {place?.name ?? 'place'}
            <button type="button" aria-label="Remove place reminder" disabled={disabled} onClick={() => update({ place: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {draft.subtasks.length > 0 && (
        <ul className={cn('mt-2 space-y-1 border-l-2 pl-3', guessed('subtasks') ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]', highlight('subtasks') && 'ring-2 ring-accent-blue/40')} aria-label="Subtasks">
          {draft.subtasks.map((subtask, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                aria-label={`Subtask ${i + 1}`}
                value={subtask}
                disabled={disabled}
                onChange={(e) => update({ subtasks: draft.subtasks.map((s, j) => (j === i ? e.target.value : s)) })}
                className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 text-meta text-[var(--text-primary)] hover:border-[var(--border-color)]"
              />
              <button type="button" aria-label={`Remove subtask ${subtask}`} disabled={disabled} onClick={() => update({ subtasks: draft.subtasks.filter((_, j) => j !== i) })} className="text-[var(--text-secondary)] hover:text-danger">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {dropped.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-caption text-[var(--text-secondary)]">
          {dropped.map((d, i) => (
            <li key={i}>Not understood: {FIELD_NAMES[d.field] ?? d.field} {droppedValue(d.value)}</li>
          ))}
        </ul>
      )}
      {draft.guessed.length > 0 && (
        <p className="mt-1 text-caption text-[var(--text-secondary)]">Dashed: check {draft.guessed.map((f) => FIELD_NAMES[f] ?? f).join(', ')}</p>
      )}
    </article>
  )
}
