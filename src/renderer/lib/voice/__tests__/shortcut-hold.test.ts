import { describe, expect, it } from 'vitest'
import { parseAccelerator, type KeyLike } from '../../accelerator'
import { SHORTCUT_IDLE, TAP_MAX_MS, shortcutStep, type ShortcutEvent, type ShortcutState, type ShortcutStep } from '../shortcut-hold'

const mac = parseAccelerator('Command+Shift+D', true)!
const win = parseAccelerator('Ctrl+Shift+D', false)!

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike & { key?: string } => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
})
const macCombo = (extra: Partial<KeyLike> = {}) => key('KeyD', { metaKey: true, shiftKey: true, ...extra })

function run(accelerator = mac, events: ShortcutEvent[], from: ShortcutState = SHORTCUT_IDLE): ShortcutStep[] {
  const steps: ShortcutStep[] = []
  let state = from
  for (const event of events) {
    const next = shortcutStep(accelerator, state, event)
    steps.push(next)
    state = next.state
  }
  return steps
}
const effects = (steps: ShortcutStep[]) => steps.map((s) => s.effect)

describe('voice shortcut hold', () => {
  it('hold to talk: the press starts, letting go of the key adds', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: macCombo() },
      { type: 'keydown', at: 500, key: macCombo({ repeat: true }) },
      { type: 'keyup', at: 2000, key: key('KeyD', { metaKey: true, shiftKey: true }) },
    ])
    expect(effects(steps)).toEqual(['start', 'none', 'add'])
    expect(steps.map((s) => s.consume)).toEqual([true, true, true])
    expect(steps.at(-1)!.state).toEqual(SHORTCUT_IDLE)
  })

  it('letting go of a modifier first also adds (macOS sends no key-up for D while Command is down)', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: macCombo() },
      { type: 'keyup', at: 1500, key: key('MetaLeft', { shiftKey: true }) },
    ])
    expect(effects(steps)).toEqual(['start', 'add'])
  })

  it('a tap latches: listening goes on until the shortcut again', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: macCombo() },
      { type: 'keyup', at: TAP_MAX_MS - 100, key: key('KeyD', { metaKey: true, shiftKey: true }) },
      { type: 'keyup', at: TAP_MAX_MS - 50, key: key('MetaLeft', { shiftKey: true }) },
      { type: 'keydown', at: 3000, key: macCombo() },
      { type: 'keyup', at: 3100, key: key('KeyD', { metaKey: true, shiftKey: true }) },
    ])
    expect(effects(steps)).toEqual(['start', 'none', 'none', 'add', 'none'])
    expect(steps[1].state).toEqual({ phase: 'latched' })
    expect(steps.at(-1)!.state).toEqual(SHORTCUT_IDLE)
  })

  it('Enter adds a latched capture', () => {
    const steps = run(win, [{ type: 'keydown', at: 0, key: key('Enter') }], { phase: 'latched' })
    expect(effects(steps)).toEqual(['add'])
    expect(steps[0].consume).toBe(true)
  })

  it('Escape cancels while held or latched', () => {
    expect(effects(run(mac, [{ type: 'keydown', at: 10, key: key('Escape') }], { phase: 'held', downAt: 0 }))).toEqual(['cancel'])
    expect(effects(run(mac, [{ type: 'keydown', at: 10, key: key('Escape') }], { phase: 'latched' }))).toEqual(['cancel'])
  })

  it('Escape and Enter do nothing when no capture is on', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: key('Escape') },
      { type: 'keydown', at: 1, key: key('Enter') },
    ])
    expect(effects(steps)).toEqual(['none', 'none'])
    expect(steps.every((s) => !s.consume)).toBe(true)
  })

  it('needs the exact modifiers', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: key('KeyD', { metaKey: true }) },
      { type: 'keydown', at: 0, key: key('KeyD', { metaKey: true, shiftKey: true, altKey: true }) },
      { type: 'keydown', at: 0, key: key('KeyD', { ctrlKey: true, shiftKey: true }) },
    ])
    expect(effects(steps)).toEqual(['none', 'none', 'none'])
    expect(effects(run(win, [{ type: 'keydown', at: 0, key: key('KeyD', { ctrlKey: true, shiftKey: true }) }]))).toEqual(['start'])
  })

  it('an auto-repeat press does not start', () => {
    expect(effects(run(mac, [{ type: 'keydown', at: 0, key: macCombo({ repeat: true }) }]))).toEqual(['none'])
  })

  it('other keys while held change nothing and are not consumed', () => {
    const steps = run(mac, [
      { type: 'keydown', at: 0, key: macCombo() },
      { type: 'keydown', at: 400, key: key('KeyA', { metaKey: true, shiftKey: true }) },
      { type: 'keyup', at: 450, key: key('KeyA', { metaKey: true, shiftKey: true }) },
    ])
    expect(effects(steps)).toEqual(['start', 'none', 'none'])
    expect(steps[1].consume).toBe(false)
    expect(steps[2].state.phase).toBe('held')
  })

  it('a blurred window cancels a held capture but keeps a latched one', () => {
    expect(effects(run(mac, [{ type: 'blur' }], { phase: 'held', downAt: 0 }))).toEqual(['cancel'])
    const latched = run(mac, [{ type: 'blur' }], { phase: 'latched' })
    expect(effects(latched)).toEqual(['none'])
    expect(latched[0].state).toEqual({ phase: 'latched' })
  })

  it('does nothing without a shortcut', () => {
    expect(effects(run(null as never, [{ type: 'keydown', at: 0, key: macCombo() }]))).toEqual(['none'])
  })
})
