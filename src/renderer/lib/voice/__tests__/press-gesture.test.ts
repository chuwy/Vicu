import { describe, expect, it } from 'vitest'
import {
  CANCEL_DISTANCE_PX,
  CANCEL_DOWN_PX,
  HOLD_MS,
  LOCK_UP_PX,
  PRESS_IDLE,
  PRESS_SLOP_PX,
  pressStep,
  type PressEvent,
  type PressState,
  type PressStep,
} from '../press-gesture'

function run(events: PressEvent[], from: PressState = PRESS_IDLE): PressStep[] {
  const steps: PressStep[] = []
  let state = from
  for (const event of events) {
    const next = pressStep(state, event)
    steps.push(next)
    state = next.state
  }
  return steps
}
const effects = (steps: PressStep[]) => steps.map((s) => s.effect)

describe('press gesture on +', () => {
  it('a quick press is a click: no voice, the click runs', () => {
    const steps = run([
      { type: 'down', at: 0, x: 10, y: 10 },
      { type: 'up', at: 120 },
    ])
    expect(effects(steps)).toEqual(['none', 'none'])
    expect(steps.at(-1)!.swallowClick).toBe(false)
    expect(steps.at(-1)!.state).toEqual(PRESS_IDLE)
  })

  it('the timer firing early does not start a hold', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'tick', at: HOLD_MS - 1 },
    ])
    expect(steps.at(-1)!.state.phase).toBe('pressed')
    expect(steps.at(-1)!.effect).toBe('none')
  })

  it('holding starts listening, letting go adds and swallows the click', () => {
    const steps = run([
      { type: 'down', at: 0, x: 10, y: 10 },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 12, y: 14 },
      { type: 'up', at: 2500 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'none', 'add'])
    expect(steps.at(-1)!.swallowClick).toBe(true)
  })

  it('releasing before the hold, even after the time, stays a click when the timer had not fired', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'up', at: HOLD_MS + 50 },
    ])
    expect(effects(steps)).toEqual(['none', 'none'])
    expect(steps.at(-1)!.swallowClick).toBe(false)
  })

  it('moving before the hold makes it an ordinary press: the timer no longer starts voice', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'move', x: PRESS_SLOP_PX + 1, y: 0 },
      { type: 'tick', at: HOLD_MS },
      { type: 'up', at: HOLD_MS + 10 },
    ])
    expect(effects(steps)).toEqual(['none', 'none', 'none', 'none'])
    expect(steps.at(-1)!.swallowClick).toBe(false)
  })

  it('a small wobble before the hold is still a hold', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'move', x: 3, y: 3 },
      { type: 'tick', at: HOLD_MS },
    ])
    expect(steps.at(-1)!.effect).toBe('start')
  })

  it('sliding down arms the cancel, and releasing there cancels', () => {
    const steps = run([
      { type: 'down', at: 0, x: 100, y: 100 },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 100, y: 100 + CANCEL_DOWN_PX },
      { type: 'up', at: 1500 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'arm-cancel', 'cancel'])
    expect(steps.at(-1)!.swallowClick).toBe(true)
  })

  it('moving far away sideways arms the cancel; coming back disarms it and release adds', () => {
    const steps = run([
      { type: 'down', at: 0, x: 100, y: 100 },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 100 + CANCEL_DISTANCE_PX, y: 100 },
      { type: 'move', x: 104, y: 98 },
      { type: 'up', at: 1500 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'arm-cancel', 'disarm-cancel', 'add'])
  })

  it('moving up a little while holding does not cancel', () => {
    const steps = run([
      { type: 'down', at: 0, x: 100, y: 100 },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 100, y: 40 },
      { type: 'up', at: 900 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'none', 'add'])
  })

  it('sliding up to the lock hands the capture to smart dictation: letting go changes nothing', () => {
    const steps = run([
      { type: 'down', at: 0, x: 100, y: 100, lockable: true },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 104, y: 100 - LOCK_UP_PX + 1 },
      { type: 'move', x: 104, y: 100 - LOCK_UP_PX },
      { type: 'up', at: 1500 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'none', 'lock', 'none'])
    expect(steps[3].swallowClick).toBe(true)
    expect(steps[3].state).toEqual(PRESS_IDLE)
  })

  it('there is no lock when smart dictation is not ready, and none while the cancel is armed', () => {
    const plain = run([
      { type: 'down', at: 0, x: 100, y: 100 },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 100, y: 100 - LOCK_UP_PX - 20 },
      { type: 'up', at: 900 },
    ])
    expect(effects(plain)).toEqual(['none', 'start', 'none', 'add'])
    const away = run([
      { type: 'down', at: 0, x: 100, y: 100, lockable: true },
      { type: 'tick', at: HOLD_MS },
      { type: 'move', x: 100 + CANCEL_DISTANCE_PX, y: 100 - LOCK_UP_PX },
    ])
    expect(effects(away)).toEqual(['none', 'start', 'arm-cancel'])
  })

  it('Escape, a lost pointer or a blurred window cancels a hold', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'tick', at: HOLD_MS },
      { type: 'abort' },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'cancel'])
    expect(steps.at(-1)!.state).toEqual(PRESS_IDLE)
  })

  it('an abort before the hold changes nothing', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'abort' },
      { type: 'tick', at: HOLD_MS },
    ])
    expect(effects(steps)).toEqual(['none', 'none', 'none'])
  })

  it('a second button while holding changes nothing', () => {
    const steps = run([
      { type: 'down', at: 0, x: 0, y: 0 },
      { type: 'tick', at: HOLD_MS },
      { type: 'down', at: 600, x: 50, y: 50 },
      { type: 'up', at: 700 },
    ])
    expect(effects(steps)).toEqual(['none', 'start', 'none', 'add'])
  })
})
