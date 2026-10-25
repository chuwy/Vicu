/**
 * Whether a pointer button is held, for popovers that open in the middle of a press.
 *
 * On macOS Chromium fires `contextmenu` on the press, not on the release (Windows and Linux fire it
 * on the release). A context menu shown there is light-dismissed by the release that follows: the
 * press began before the menu existed and the release lands outside it, and the browser runs
 * light dismiss before any `pointerup` listener, so it cannot be cancelled. A popover that opens
 * while a button is held therefore waits for the release (`afterPress`).
 */

export interface PressTracker {
  /** Runs `run` now when no button is held, else on the release. Returns a cancel function. */
  afterPress: (run: () => void) => () => void
}

const RELEASES = ['pointerup', 'pointercancel'] as const
const CAPTURE = { capture: true }

export function createPressTracker(target: EventTarget): PressTracker {
  let held = false
  const track = (event: Event) => {
    held = ((event as PointerEvent).buttons ?? 0) !== 0
  }
  target.addEventListener('pointerdown', track, CAPTURE)
  for (const type of RELEASES) target.addEventListener(type, track, CAPTURE)
  // The window losing focus mid-press may swallow the release.
  target.addEventListener('blur', () => (held = false))

  return {
    afterPress(run) {
      if (!held) {
        run()
        return () => undefined
      }
      const release = () => {
        stop()
        run()
      }
      const stop = () => {
        for (const type of RELEASES) target.removeEventListener(type, release, CAPTURE)
        target.removeEventListener('blur', release)
      }
      for (const type of RELEASES) target.addEventListener(type, release, CAPTURE)
      target.addEventListener('blur', release)
      return stop
    },
  }
}

// Installed when the module loads, so it has seen the press before any popover asks.
const tracker: PressTracker | null = typeof window === 'undefined' ? null : createPressTracker(window)

export function afterPress(run: () => void): () => void {
  if (tracker) return tracker.afterPress(run)
  run()
  return () => undefined
}
