import { describe, expect, it, vi } from 'vitest'
import { createPressTracker } from '../pointer-press'

const pointer = (type: string, buttons: number) => Object.assign(new Event(type), { buttons })

// macOS fires contextmenu on the press: a menu shown then is light-dismissed by the release.
describe('afterPress', () => {
  it('runs at once when no button is held (a context menu on Windows and Linux, a click, a key)', () => {
    const target = new EventTarget()
    const { afterPress } = createPressTracker(target)
    const run = vi.fn()
    afterPress(run)
    expect(run).toHaveBeenCalledTimes(1)

    target.dispatchEvent(pointer('pointerdown', 1))
    target.dispatchEvent(pointer('pointerup', 0))
    afterPress(run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('waits for the release while a button is held (a context menu on macOS)', () => {
    const target = new EventTarget()
    const { afterPress } = createPressTracker(target)
    const run = vi.fn()
    target.dispatchEvent(pointer('pointerdown', 2))
    afterPress(run)
    expect(run).not.toHaveBeenCalled()
    target.dispatchEvent(pointer('pointerup', 0))
    expect(run).toHaveBeenCalledTimes(1)
    target.dispatchEvent(pointer('pointerup', 0))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('also opens on a cancelled press or when the window loses focus', () => {
    for (const release of [pointer('pointercancel', 0), new Event('blur')]) {
      const target = new EventTarget()
      const { afterPress } = createPressTracker(target)
      const run = vi.fn()
      target.dispatchEvent(pointer('pointerdown', 2))
      afterPress(run)
      target.dispatchEvent(release)
      expect(run).toHaveBeenCalledTimes(1)
      const next = vi.fn()
      afterPress(next)
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('never runs once cancelled (the menu closed before the release)', () => {
    const target = new EventTarget()
    const { afterPress } = createPressTracker(target)
    const run = vi.fn()
    target.dispatchEvent(pointer('pointerdown', 2))
    const cancel = afterPress(run)
    cancel()
    target.dispatchEvent(pointer('pointerup', 0))
    expect(run).not.toHaveBeenCalled()
  })
})
