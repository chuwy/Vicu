import { isAcceleratorKey, matchesAccelerator, type KeyLike, type ParsedAccelerator } from '../accelerator'

// The in-app voice shortcut (docs/voice-input.md). Pure: the caller passes each key event with
// its time and performs the effect.
//
// - Press and hold the shortcut: listening starts on the key press; letting go of any of its keys
//   adds the task (push to talk).
// - Tap it (let go within TAP_MAX_MS): listening stays on ("latched") until the shortcut is
//   pressed again or Enter adds, or Escape cancels. Nothing has to be held, so it also works for
//   someone who cannot hold keys.
// - Escape cancels in either mode. A window that loses focus while the keys are held cancels (the
//   key-up will never arrive); a latched session keeps listening.

export const TAP_MAX_MS = 300

export type ShortcutState =
  | { phase: 'idle' }
  | { phase: 'held'; downAt: number }
  | { phase: 'latched' }

export type ShortcutEffect = 'none' | 'start' | 'add' | 'cancel'

export interface ShortcutStep {
  state: ShortcutState
  effect: ShortcutEffect
  /** The event belongs to the shortcut: prevent its default (and keep it from the page). */
  consume: boolean
}

export type ShortcutEvent =
  | { type: 'keydown'; at: number; key: KeyLike & { key?: string } }
  | { type: 'keyup'; at: number; key: KeyLike }
  | { type: 'blur' }

export const SHORTCUT_IDLE: ShortcutState = { phase: 'idle' }

const result = (state: ShortcutState, effect: ShortcutEffect = 'none', consume = false): ShortcutStep => ({ state, effect, consume })

export function shortcutStep(accelerator: ParsedAccelerator | null, state: ShortcutState, event: ShortcutEvent): ShortcutStep {
  if (event.type === 'blur') {
    if (state.phase === 'held') return result(SHORTCUT_IDLE, 'cancel')
    return result(state)
  }

  if (event.type === 'keydown') {
    const isEscape = event.key.code === 'Escape' || event.key.key === 'Escape'
    const isEnter = event.key.code === 'Enter' || event.key.code === 'NumpadEnter'
    if (state.phase !== 'idle' && isEscape) return result(SHORTCUT_IDLE, 'cancel', true)
    const matches = accelerator !== null && matchesAccelerator(accelerator, event.key)
    switch (state.phase) {
      case 'idle':
        if (matches && !event.key.repeat) return result({ phase: 'held', downAt: event.at }, 'start', true)
        return result(state)
      case 'held':
        // Auto-repeat while held, and other keys, change nothing; the repeat is still ours.
        return result(state, 'none', matches)
      case 'latched':
        if (matches && !event.key.repeat) return result(SHORTCUT_IDLE, 'add', true)
        if (isEnter) return result(SHORTCUT_IDLE, 'add', true)
        return result(state)
    }
  }

  // keyup
  if (state.phase === 'held' && accelerator && isAcceleratorKey(accelerator, event.key.code)) {
    if (event.at - state.downAt >= TAP_MAX_MS) return result(SHORTCUT_IDLE, 'add', true)
    return result({ phase: 'latched' }, 'none', true)
  }
  return result(state)
}
