// Electron accelerator strings ("Command+Shift+D", "Alt+Shift+V") and keyboard events. Pure: the
// platform is passed in, so the hotkey recorder and the in-app voice shortcut share one reading.

/** The fields of a KeyboardEvent this module reads. */
export interface KeyLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
}

/**
 * Maps KeyboardEvent.code to Electron accelerator key name.
 * Uses e.code (physical key) instead of e.key (character) to avoid
 * macOS character composition issues with Alt/Option key.
 */
export function codeToAcceleratorKey(code: string): string | null {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (code.startsWith('Arrow')) return code.slice(5)
  if (code.startsWith('Numpad') && code.length === 7 && /\d$/.test(code)) return 'num' + code.slice(6)

  const numpadMap: Record<string, string> = {
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
    NumpadEnter: 'Enter',
  }
  if (numpadMap[code]) return numpadMap[code]

  const directMap: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  }
  if (directMap[code]) return directMap[code]

  const punctuationMap: Record<string, string> = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
    Comma: ',', Period: '.', Slash: '/',
  }
  if (punctuationMap[code]) return punctuationMap[code]

  return null
}

export const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
])

/** The accelerator a key press makes, or null (a modifier alone, no modifier, an unknown key). */
export function keyEventToAccelerator(e: KeyLike, isMac: boolean): string | null {
  const parts: string[] = []
  if (isMac) {
    if (e.metaKey) parts.push('Command')
    if (e.ctrlKey) parts.push('Ctrl')
  } else {
    if (e.ctrlKey) parts.push('Ctrl')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  if (MODIFIER_CODES.has(e.code)) return null
  if (parts.length === 0) return null

  const key = codeToAcceleratorKey(e.code)
  if (!key) return null

  parts.push(key)
  return parts.join('+')
}

/** Convert Electron accelerator strings to macOS symbols for display */
export function formatAcceleratorForDisplay(accelerator: string, isMac: boolean): string {
  if (!isMac) return accelerator
  return accelerator
    .replace(/Command\+?/g, '⌘')
    .replace(/Ctrl\+?/g, '⌃')
    .replace(/Alt\+?/g, '⌥')
    .replace(/Shift\+?/g, '⇧')
}

/** An accelerator as the modifiers it needs and its key (the accelerator key name, e.g. "D", "Space"). */
export interface ParsedAccelerator {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

/** Reads an accelerator; null when it is empty or has no key. */
export function parseAccelerator(spec: string | null | undefined, isMac: boolean): ParsedAccelerator | null {
  if (!spec) return null
  const parsed: ParsedAccelerator = { ctrl: false, meta: false, alt: false, shift: false, key: '' }
  for (const raw of spec.split('+')) {
    const part = raw.trim()
    if (!part) continue
    switch (part.toLowerCase()) {
      case 'command': case 'cmd': case 'meta': case 'super':
        parsed.meta = true
        break
      case 'commandorcontrol': case 'cmdorctrl':
        if (isMac) parsed.meta = true
        else parsed.ctrl = true
        break
      case 'ctrl': case 'control':
        parsed.ctrl = true
        break
      case 'alt': case 'option':
        parsed.alt = true
        break
      case 'shift':
        parsed.shift = true
        break
      default:
        parsed.key = part.length === 1 ? part.toUpperCase() : part
    }
  }
  return parsed.key ? parsed : null
}

/** True when the press is exactly this accelerator (no extra modifier). */
export function matchesAccelerator(accelerator: ParsedAccelerator, e: KeyLike): boolean {
  if (e.ctrlKey !== accelerator.ctrl || e.metaKey !== accelerator.meta || e.altKey !== accelerator.alt || e.shiftKey !== accelerator.shift) return false
  const key = codeToAcceleratorKey(e.code)
  return key !== null && key.toLowerCase() === accelerator.key.toLowerCase()
}

/** True when the key is one the accelerator is held with: its key or one of its modifiers. */
export function isAcceleratorKey(accelerator: ParsedAccelerator, code: string): boolean {
  if (code === 'ControlLeft' || code === 'ControlRight') return accelerator.ctrl
  if (code === 'MetaLeft' || code === 'MetaRight') return accelerator.meta
  if (code === 'AltLeft' || code === 'AltRight') return accelerator.alt
  if (code === 'ShiftLeft' || code === 'ShiftRight') return accelerator.shift
  const key = codeToAcceleratorKey(code)
  return key !== null && key.toLowerCase() === accelerator.key.toLowerCase()
}
