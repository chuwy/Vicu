import { describe, expect, it } from 'vitest'
import { voiceHotkeyConflict } from '../shortcut-conflicts'

describe('voiceHotkeyConflict', () => {
  it('accepts the defaults next to the default Quick Entry and Quick View hotkeys', () => {
    const mac = { quick_entry_enabled: true, quick_entry_hotkey: 'Command+Shift+Space', quick_view_enabled: true, quick_view_hotkey: 'Command+Shift+B' }
    expect(voiceHotkeyConflict('Command+Shift+D', mac, true)).toBeNull()
    const win = { quick_entry_enabled: true, quick_entry_hotkey: 'Alt+Shift+V', quick_view_enabled: true, quick_view_hotkey: 'Alt+Shift+B' }
    expect(voiceHotkeyConflict('Ctrl+Shift+D', win, false)).toBeNull()
  })

  it('names an enabled global hotkey that takes the keys first', () => {
    const config = { quick_entry_enabled: true, quick_entry_hotkey: 'Command+Shift+Space' }
    expect(voiceHotkeyConflict('Command+Shift+Space', config, true)).toMatch(/Quick Entry/)
    expect(voiceHotkeyConflict('Command+Shift+Space', { ...config, quick_entry_enabled: false }, true)).toBeNull()
  })

  it('names an app shortcut with the same keys', () => {
    expect(voiceHotkeyConflict('Command+N', {}, true)).toMatch(/New task/)
    expect(voiceHotkeyConflict('Ctrl+Shift+C', {}, false)).toMatch(/Comments/)
  })

  it('has nothing to say about an empty shortcut', () => {
    expect(voiceHotkeyConflict('', {}, true)).toBeNull()
  })
})
