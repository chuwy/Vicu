import { create } from 'zustand'
import { createRecognizer, type VoiceRecognizer } from '@/lib/voice/recognizer'
import { toast } from '@/stores/toast-store'
import { announce } from '@/stores/announcer-store'
import type { VoiceErrorCode } from '../../shared/voice-types'
import type { VoiceListDefaults } from '@/lib/voice/voice-task'
import { useVoiceListStore } from '@/stores/voice-list-store'

// One voice capture at a time (docs/voice-input.md): who started it, what has been heard, and
// whether letting go adds or cancels. The + button, the voice shortcut and the command palette
// start it; VoiceHost draws the card and adds the task when the final text arrives.

/** What started the capture: holding +, the voice shortcut, or "Say a task" (palette). */
export type VoiceSource = 'button' | 'shortcut' | 'command'
/** `hold`: letting go adds. `latched`: listening until Enter, the shortcut again, or Add. */
export type VoiceMode = 'hold' | 'latched'
export type VoicePhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'adding'

interface VoiceState {
  phase: VoicePhase
  source: VoiceSource
  mode: VoiceMode
  /** The words so far. */
  text: string
  /** The composer defaults of the list on screen when the capture started (null: the Inbox). */
  list: VoiceListDefaults | null
  /** The pointer moved away while holding +: letting go now cancels. */
  cancelArmed: boolean
  /** The final text, waiting for VoiceHost to add it (phase `adding`). */
  finalText: string | null
  /** Bumped when there is no engine here: VoiceHost opens the composer instead. */
  fallbackRequest: number
  begin: (source: VoiceSource, mode: VoiceMode) => void
  setMode: (mode: VoiceMode) => void
  armCancel: (armed: boolean) => void
  /** Stop listening and add what was heard. */
  finish: () => void
  /** Throw the words away. */
  cancel: () => void
  /** VoiceHost added (or gave up on) the final text. */
  done: () => void
}

let recognizer: VoiceRecognizer | null = null
function getRecognizer(): VoiceRecognizer {
  recognizer ??= createRecognizer(window.api.voice, () => navigator.language)
  return recognizer
}

/** Test hook: use a fake recognizer. */
export function setVoiceRecognizer(next: VoiceRecognizer | null): void {
  recognizer = next
}

const IDLE = { phase: 'idle' as const, text: '', cancelArmed: false, finalText: null }

function errorToast(code: VoiceErrorCode, message: string): void {
  if (code === 'unsupported') {
    toast.info('Voice input is not available on this system')
    return
  }
  toast.error(message || 'Voice input stopped.')
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  ...IDLE,
  source: 'button',
  mode: 'hold',
  list: null,
  fallbackRequest: 0,

  begin: (source, mode) => {
    if (get().phase !== 'idle') return
    // The list is read once: navigating while talking does not move the task.
    set({ ...IDLE, phase: 'starting', source, mode, list: useVoiceListStore.getState().defaults })
    announce('Listening. Say the task.')
    void getRecognizer().start({
      onReady: () => {
        if (get().phase === 'starting') set({ phase: 'listening' })
      },
      onPartial: (text) => {
        const phase = get().phase
        if (phase === 'starting' || phase === 'listening' || phase === 'finishing') set({ text, phase: phase === 'starting' ? 'listening' : phase })
      },
      onFinal: (text) => {
        if (get().phase === 'idle') return
        const heard = text.trim() || get().text.trim()
        if (!heard) {
          set(IDLE)
          toast.info('Nothing was heard')
          return
        }
        set({ phase: 'adding', text: heard, finalText: heard, cancelArmed: false })
      },
      onError: (code, message) => {
        if (get().phase === 'idle') return
        set(IDLE)
        errorToast(code, message)
        if (code === 'unsupported') set((state) => ({ fallbackRequest: state.fallbackRequest + 1 }))
      },
    })
  },

  setMode: (mode) => {
    if (get().phase !== 'idle') set({ mode })
  },

  armCancel: (armed) => {
    if (get().phase !== 'idle' && get().cancelArmed !== armed) set({ cancelArmed: armed })
  },

  finish: () => {
    const { phase } = get()
    if (phase !== 'starting' && phase !== 'listening') return
    set({ phase: 'finishing', cancelArmed: false })
    getRecognizer().stop()
  },

  cancel: () => {
    const { phase } = get()
    if (phase === 'idle' || phase === 'adding') return
    getRecognizer().cancel()
    set(IDLE)
    announce('Voice input cancelled')
  },

  done: () => set(IDLE),
}))

/** True while a capture is on screen. */
export function isVoiceActive(): boolean {
  return useVoiceStore.getState().phase !== 'idle'
}
