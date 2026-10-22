import { describe, expect, it } from 'vitest'
import {
  formatAcceleratorForDisplay,
  isAcceleratorKey,
  keyEventToAccelerator,
  matchesAccelerator,
  parseAccelerator,
} from '../accelerator'

const press = (code: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('accelerators', () => {
  it('records a key press as an accelerator per platform', () => {
    expect(keyEventToAccelerator(press('KeyD', { metaKey: true, shiftKey: true }), true)).toBe('Command+Shift+D')
    expect(keyEventToAccelerator(press('KeyD', { ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+D')
    expect(keyEventToAccelerator(press('Space', { altKey: true }), false)).toBe('Alt+Space')
    expect(keyEventToAccelerator(press('KeyD'), false)).toBeNull()
    expect(keyEventToAccelerator(press('ShiftLeft', { shiftKey: true }), false)).toBeNull()
  })

  it('reads accelerators, CommandOrControl per platform', () => {
    expect(parseAccelerator('Command+Shift+D', true)).toEqual({ ctrl: false, meta: true, alt: false, shift: true, key: 'D' })
    expect(parseAccelerator('CmdOrCtrl+n', false)).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: 'N' })
    expect(parseAccelerator('CmdOrCtrl+n', true)?.meta).toBe(true)
    expect(parseAccelerator('', true)).toBeNull()
    expect(parseAccelerator('Shift+Alt', true)).toBeNull()
  })

  it('matches a press exactly, by physical key', () => {
    const accel = parseAccelerator('Alt+Shift+Space', false)!
    expect(matchesAccelerator(accel, press('Space', { altKey: true, shiftKey: true }))).toBe(true)
    expect(matchesAccelerator(accel, press('Space', { altKey: true }))).toBe(false)
    expect(matchesAccelerator(accel, press('Space', { altKey: true, shiftKey: true, ctrlKey: true }))).toBe(false)
  })

  it('knows which keys hold an accelerator down', () => {
    const accel = parseAccelerator('Command+Shift+D', true)!
    expect(isAcceleratorKey(accel, 'KeyD')).toBe(true)
    expect(isAcceleratorKey(accel, 'MetaRight')).toBe(true)
    expect(isAcceleratorKey(accel, 'ShiftLeft')).toBe(true)
    expect(isAcceleratorKey(accel, 'AltLeft')).toBe(false)
    expect(isAcceleratorKey(accel, 'KeyE')).toBe(false)
  })

  it('shows macOS symbols on a Mac only', () => {
    expect(formatAcceleratorForDisplay('Command+Shift+D', true)).toBe('⌘⇧D')
    expect(formatAcceleratorForDisplay('Ctrl+Shift+D', false)).toBe('Ctrl+Shift+D')
  })
})
