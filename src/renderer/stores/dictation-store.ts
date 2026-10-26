import { create } from 'zustand'
import {
  changedFields,
  checkDictationAnswer,
  dictationUserMessage,
  draftsAsAnswer,
  localDateTimeOf,
  type CheckedDraft,
  type DictationAnswer,
  type DroppedField,
} from '../../shared/ai/dictation'
import { DICTATION_FIELDS, type DraftField } from '../../shared/ai/contract'
import type { AiError, KeptTranscript } from '../../shared/ai/types'
import { joinWords } from '../../shared/ai/turns'
import { contextProjects, defaultProjectFor, dictationContextFor, type AiWorkspace, type ListInfo } from '@/lib/ai/workspace'
import { readSaid } from '@/lib/ai/said-parser'
import { cancelOpenMic, startOpenMic, useOpenMicStore, type AdoptedSession, type OpenMicClient } from '@/lib/ai/open-mic'
import { announce } from '@/stores/announcer-store'
import { useVoiceStore } from '@/stores/voice-store'

// Smart dictation (docs/ai-assistant-v1.md section 4): the transcript, one request, the checks,
// and the draft cards the user changes and adds (DictationHost draws them and adds them). Spoken,
// it keeps the microphone open (3.7): the first turn is the dictation request, each later turn an
// edit of the cards (4.4), and talking again cancels a request still running so its words go out
// with the new ones. Also "Make tasks from this" (text from outside) and "Break into steps" (a
// task's notes, the answer's tasks become its subtasks). A failed request keeps the transcript on
// the device until it is added or discarded (4.6).

export interface DraftCard {
  draft: CheckedDraft
  /** Fields an edit by voice changed (highlighted). */
  changed: DraftField[]
  /** Fields the checks left empty, with what the model said (explained on the card). */
  dropped: DroppedField[]
}

/** `live`: the panel is open and listening, nothing has been sent yet. */
export type DictationPhase = 'idle' | 'live' | 'requesting' | 'cards' | 'failed' | 'empty' | 'adding'

export interface DictationParent {
  id: number
  title: string
  project_id: number
}

export type DictationSource = 'voice' | 'text' | 'steps'

interface DictationState {
  phase: DictationPhase
  source: DictationSource
  transcript: string
  /** When the recording ended, local `YYYY-MM-DDTHH:mm:ss`. */
  reference: string
  list: ListInfo | null
  parent: DictationParent | null
  cards: DraftCard[]
  unclear: string[]
  error: string | null
  /** The kept transcript (4.6) this panel shows, if any. */
  keptId: string | null
  /** An edit by voice: its request while it runs, or why it failed. */
  edit: { phase: 'idle' | 'requesting'; words: string; error: string | null }
  open: (input: { transcript: string; list: ListInfo | null; source: DictationSource; parent?: DictationParent | null; reference?: string; keptId?: string | null }) => void
  /**
   * Spoken smart dictation: opens the panel listening (or keeps the one open) with the microphone
   * on. `adopt` takes over a quick capture that was locked, with the words it heard.
   */
  startLive: (input?: { list?: ListInfo | null; adopt?: AdoptedSession }) => void
  /** Turns the microphone on in the open panel. */
  listen: () => void
  retry: () => void
  editByVoice: (instruction: string) => Promise<void>
  /** Stops the request that is running (its answer is ignored): back to listening, or the cards as they were. */
  cancelRequest: () => void
  updateDraft: (ref: string, change: Partial<CheckedDraft>) => void
  removeDraft: (ref: string) => void
  setPhase: (phase: DictationPhase) => void
  /** Closes the panel; a kept transcript is dropped (`discard`) or stays for later. */
  close: (options?: { discard?: boolean }) => void
}

export interface DictationDeps {
  workspace: () => AiWorkspace
  /** The locale slash dates are read with. */
  locale: () => string
  /** The list on screen, whose defaults new tasks get. */
  list: () => ListInfo | null
}

let deps: DictationDeps | null = null
let requestCounter = 0
/** The request whose answer is waited for; a cancelled or replaced one is ignored when it comes. */
let activeRequest: string | null = null

/** Set by DictationHost, which knows the window's caches. */
export function setDictationDeps(next: DictationDeps | null): void {
  deps = next
}

function errorText(error: AiError): string {
  switch (error.kind) {
    case 'timeout': return 'The model did not answer in time.'
    case 'network': return 'Could not reach the model.'
    case 'auth': return 'The provider refused the key.'
    case 'bad_answer': return 'The model’s answer could not be used.'
    default: return error.message || 'The request failed.'
  }
}

const EMPTY_EDIT = { phase: 'idle' as const, words: '', error: null }

export const useDictationStore = create<DictationState>((set, get) => {
  async function run(edit: string | null): Promise<void> {
    if (!deps) return
    const ws = deps.workspace()
    const state = get()
    const id = `dictation-${Date.now()}-${++requestCounter}`
    activeRequest = id
    const contextJson = dictationContextFor(ws, state.list, state.reference)
    const drafts = edit !== null
      ? draftsAsAnswer(state.cards.map((card) => card.draft), (placeId) => ws.places.find((p) => p.id === placeId)?.name ?? null)
      : undefined
    const user = dictationUserMessage(contextJson, edit ?? state.transcript, drafts)
    const result = await window.api.ai.dictate({ requestId: id, edit: edit !== null, user })
    // Closed, cancelled by talking on, or replaced while it ran.
    if (activeRequest !== id) return
    activeRequest = null
    const now = get()
    if (now.phase === 'idle') return

    if (!result.success) {
      if (edit !== null) {
        set({ edit: { phase: 'idle', words: edit, error: errorText(result.error) } })
        return
      }
      const keptId = now.keptId ?? id
      const kept: KeptTranscript = {
        id: keptId,
        transcript: now.transcript,
        reference: now.reference,
        error: errorText(result.error),
        list: now.list ? { name: now.list.name, projectId: now.list.projectId, defaultDue: now.list.defaultDue } : null,
        parentTaskId: now.parent?.id ?? null,
      }
      void window.api.ai.keepTranscript(kept)
      set({ phase: 'failed', error: kept.error, keptId })
      announce('The tasks could not be made. The transcript is kept.')
      return
    }

    const checked = checkDictationAnswer(result.data as DictationAnswer, {
      reference: now.reference,
      defaultDue: now.list?.defaultDue ?? null,
      projects: contextProjects(ws),
      default_project_id: defaultProjectFor(ws, now.list),
      labels: ws.labels,
      places: ws.places,
      readSaid: (said) => readSaid(said, now.reference, deps?.locale()),
    })
    const previous = new Map(now.cards.map((card) => [card.draft.ref, card.draft]))
    const cards = checked.drafts.map((draft): DraftCard => {
      const before = edit !== null ? previous.get(draft.ref) : undefined
      let next = draft
      if (before) {
        // A due date or project the edit left alone keeps how sure it was.
        const guessed = new Set(draft.guessed)
        if (before.due === draft.due) {
          if (before.guessed.includes('when')) guessed.add('when')
          else guessed.delete('when')
        }
        if (before.project_id === draft.project_id) {
          if (before.guessed.includes('project')) guessed.add('project')
          else guessed.delete('project')
        }
        next = { ...draft, guessed: DICTATION_FIELDS.filter((field) => guessed.has(field)) }
      }
      return {
        draft: next,
        changed: edit !== null ? (before ? changedFields(before, next) : ['title']) : [],
        dropped: checked.dropped.filter((d) => d.ref === draft.ref),
      }
    })
    if (cards.length === 0) {
      set({ phase: 'empty', cards: [], unclear: checked.unclear, error: null, edit: EMPTY_EDIT })
      announce('Nothing to add')
      return
    }
    // The kept transcript has served its purpose once there are cards.
    if (now.keptId) void window.api.ai.dropKeptTranscript(now.keptId)
    set({ phase: 'cards', cards, unclear: checked.unclear, error: null, keptId: null, edit: EMPTY_EDIT })
    announce(cards.length === 1 ? '1 task to check' : `${cards.length} tasks to check`)
  }

  /** A turn's words to the model: the dictation request, or an edit once there are cards. */
  const client: OpenMicClient = {
    onTurn: async (text) => {
      const state = get()
      if (state.phase === 'cards') return get().editByVoice(text)
      if (state.phase === 'adding' || state.phase === 'idle') return
      // Nothing made yet: the request again, with what was said before a failure, an empty answer,
      // or a Retry still running.
      if (state.phase === 'requesting' && activeRequest) void window.api.ai.cancelDictation(activeRequest)
      const transcript = state.phase === 'live' ? text : joinWords(state.transcript, text)
      set({ phase: 'requesting', transcript, reference: localDateTimeOf(new Date()), unclear: [], error: null })
      await run(null)
    },
    onInterrupt: () => get().cancelRequest(),
    onOff: () => {
      // Turned off before anything was said: nothing to show.
      if (get().phase === 'live') get().close()
    },
  }

  return {
    phase: 'idle',
    source: 'voice',
    transcript: '',
    reference: '',
    list: null,
    parent: null,
    cards: [],
    unclear: [],
    error: null,
    keptId: null,
    edit: EMPTY_EDIT,

    open: ({ transcript, list, source, parent = null, reference, keptId = null }) => {
      set({
        phase: 'requesting',
        source,
        transcript,
        reference: reference ?? localDateTimeOf(new Date()),
        list,
        parent,
        cards: [],
        unclear: [],
        error: null,
        keptId,
        edit: EMPTY_EDIT,
      })
      void run(null)
    },

    startLive: (input = {}) => {
      if (get().phase === 'idle') {
        set({
          phase: 'live',
          source: 'voice',
          transcript: '',
          reference: localDateTimeOf(new Date()),
          list: input.list !== undefined ? input.list : deps?.list() ?? null,
          parent: null,
          cards: [],
          unclear: [],
          error: null,
          keptId: null,
          edit: EMPTY_EDIT,
        })
      }
      // A quick capture still running gives way, unless it is the one handed over.
      if (!input.adopt) useVoiceStore.getState().cancel()
      startOpenMic('dictation', client, input.adopt)
      announce('Listening. Say your tasks; pause and they appear as cards.')
    },

    listen: () => {
      if (get().phase === 'idle' || useOpenMicStore.getState().owner === 'dictation') return
      useVoiceStore.getState().cancel()
      startOpenMic('dictation', client)
    },

    retry: () => {
      if (get().phase !== 'failed' && get().phase !== 'empty') return
      set({ phase: 'requesting', error: null })
      void run(null)
    },

    cancelRequest: () => {
      const id = activeRequest
      if (!id) return
      activeRequest = null
      void window.api.ai.cancelDictation(id)
      if (get().phase === 'requesting') set({ phase: 'live', transcript: '' })
      else set({ edit: EMPTY_EDIT })
    },

    editByVoice: async (instruction) => {
      const words = instruction.trim()
      if (!words || get().phase !== 'cards') {
        set({ edit: EMPTY_EDIT })
        return
      }
      set({ edit: { phase: 'requesting', words, error: null } })
      await run(words)
    },

    updateDraft: (ref, change) => set((state) => ({
      cards: state.cards.map((card) => card.draft.ref === ref
        ? {
            ...card,
            draft: { ...card.draft, ...change, guessed: card.draft.guessed.filter((field) => !touched(change).includes(field)) },
            dropped: card.dropped.filter((d) => !touched(change).includes(d.field as DraftField)),
          }
        : card),
    })),

    removeDraft: (ref) => {
      const cards = get().cards.filter((card) => card.draft.ref !== ref)
      if (cards.length > 0) set({ cards })
      // Still listening: the next words start over.
      else if (useOpenMicStore.getState().owner === 'dictation') set({ cards, phase: 'live', transcript: '', unclear: [] })
      else get().close()
    },

    setPhase: (phase) => set({ phase }),

    close: (options) => {
      const { keptId } = get()
      if (activeRequest) void window.api.ai.cancelDictation(activeRequest)
      activeRequest = null
      if (options?.discard && keptId) void window.api.ai.dropKeptTranscript(keptId)
      set({ phase: 'idle', cards: [], unclear: [], error: null, transcript: '', keptId: null, edit: EMPTY_EDIT, parent: null })
      if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
    },
  }
})

/** The draft fields a hand edit touched (they are no longer guessed). */
function touched(change: Partial<CheckedDraft>): DraftField[] {
  const fields: DraftField[] = []
  if ('title' in change) fields.push('title')
  if ('notes' in change) fields.push('notes')
  if ('due' in change) fields.push('when')
  if ('project_id' in change) fields.push('project')
  if ('labels' in change) fields.push('labels')
  if ('priority' in change) fields.push('priority')
  if ('repeat' in change) fields.push('repeat')
  if ('reminder' in change) fields.push('reminder')
  if ('place' in change) fields.push('place')
  if ('subtasks' in change) fields.push('subtasks')
  return fields
}

/** A dictation panel is on screen. */
export function isDictationOpen(): boolean {
  return useDictationStore.getState().phase !== 'idle'
}
