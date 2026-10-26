// Click or hold on the + (new task) button (docs/voice-input.md). Pure: every event carries its
// time and position, the caller owns the timer and the pointer capture.
//
// - A press released before HOLD_MS is a click: nothing happens here and the button's own click
//   runs, exactly as before.
// - A press that moves more than PRESS_SLOP_PX before HOLD_MS is not a hold either (a wobble, a
//   drag): it stays a plain press, so the click still runs if it ends on the button.
// - A press held HOLD_MS starts listening. Releasing adds the task. Moving well away (down by
//   CANCEL_DOWN_PX, or CANCEL_DISTANCE_PX in any direction) arms the cancel: releasing there
//   throws the words away, and coming back disarms it. Escape, a lost pointer or a blurred
//   window cancel at once. The click that follows a hold is swallowed.
// - When the press may lock (smart dictation is ready), sliding up by LOCK_UP_PX while holding
//   locks it at once: the hold ends, listening goes on as smart dictation, and letting go changes
//   nothing (docs/ai-assistant-v1.md section 4).

export const HOLD_MS = 400
export const PRESS_SLOP_PX = 8
export const CANCEL_DOWN_PX = 60
export const CANCEL_DISTANCE_PX = 140
export const LOCK_UP_PX = 60

export type PressState =
  | { phase: 'idle' }
  /** Down, not yet a hold. */
  | { phase: 'pressed'; startAt: number; x: number; y: number; lockable: boolean }
  /** Moved before the hold: an ordinary press from here on. */
  | { phase: 'passive' }
  | { phase: 'holding'; x: number; y: number; away: boolean; lockable: boolean }

export type PressEvent =
  | { type: 'down'; at: number; x: number; y: number; lockable?: boolean }
  | { type: 'move'; x: number; y: number }
  /** The hold timer fired (or any later check of the clock). */
  | { type: 'tick'; at: number }
  | { type: 'up'; at: number }
  /** Escape, pointercancel, lost capture, window blur. */
  | { type: 'abort' }

export type PressEffect =
  | 'none'
  /** Start listening (the hold began). */
  | 'start'
  /** The pointer left the button area: releasing now cancels. */
  | 'arm-cancel'
  | 'disarm-cancel'
  /** Released while listening: add what was heard. */
  | 'add'
  /** Throw the utterance away. */
  | 'cancel'
  /** Slid up to the lock: listening goes on as smart dictation. */
  | 'lock'

export interface PressStep {
  state: PressState
  effect: PressEffect
  /** True when the click event that follows this release must not run (the press was a hold). */
  swallowClick: boolean
}

export const PRESS_IDLE: PressState = { phase: 'idle' }

function step(state: PressState, effect: PressEffect = 'none', swallowClick = false): PressStep {
  return { state, effect, swallowClick }
}

/** True when the pointer is far enough from where the hold started to cancel on release. */
export function isAway(fromX: number, fromY: number, x: number, y: number): boolean {
  const dx = x - fromX
  const dy = y - fromY
  return dy >= CANCEL_DOWN_PX || Math.hypot(dx, dy) >= CANCEL_DISTANCE_PX
}

export function pressStep(state: PressState, event: PressEvent): PressStep {
  switch (event.type) {
    case 'down':
      // A second button while holding changes nothing.
      if (state.phase === 'holding') return step(state)
      return step({ phase: 'pressed', startAt: event.at, x: event.x, y: event.y, lockable: event.lockable === true })

    case 'move':
      if (state.phase === 'pressed') {
        if (Math.hypot(event.x - state.x, event.y - state.y) > PRESS_SLOP_PX) return step({ phase: 'passive' })
        return step(state)
      }
      if (state.phase === 'holding') {
        const away = isAway(state.x, state.y, event.x, event.y)
        if (state.lockable && !away && state.y - event.y >= LOCK_UP_PX) return step(PRESS_IDLE, 'lock', true)
        if (away === state.away) return step(state)
        return step({ ...state, away }, away ? 'arm-cancel' : 'disarm-cancel')
      }
      return step(state)

    case 'tick':
      if (state.phase === 'pressed' && event.at - state.startAt >= HOLD_MS) {
        return step({ phase: 'holding', x: state.x, y: state.y, away: false, lockable: state.lockable }, 'start')
      }
      return step(state)

    case 'up':
      // Released before listening started (even if the timer is late): a click.
      if (state.phase === 'holding') return step(PRESS_IDLE, state.away ? 'cancel' : 'add', true)
      return step(PRESS_IDLE)

    case 'abort':
      if (state.phase === 'holding') return step(PRESS_IDLE, 'cancel', true)
      return step(PRESS_IDLE)
  }
}
