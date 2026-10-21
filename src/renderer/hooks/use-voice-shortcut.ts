import { useEffect, useMemo } from 'react'
import { matchesAccelerator, parseAccelerator } from '@/lib/accelerator'
import { SHORTCUT_IDLE, shortcutStep, type ShortcutState, type ShortcutStep } from '@/lib/voice/shortcut-hold'
import { useVoiceStore } from '@/stores/voice-store'

const isMac = window.api.platform === 'darwin'

/**
 * The in-app voice shortcut (Settings, Keyboard Shortcuts; config `voice_hotkey`): hold it in the
 * main window to say a task, let go to add; tap it to keep listening until it is pressed again or
 * Enter (lib/voice/shortcut-hold.ts). Not a global shortcut: Electron's globalShortcut has no key
 * up, so holding cannot work outside the window (docs/voice-input.md).
 */
export function useVoiceShortcut(spec: string | undefined): void {
  const accelerator = useMemo(() => parseAccelerator(spec, isMac), [spec])

  useEffect(() => {
    if (!accelerator) return
    let state: ShortcutState = SHORTCUT_IDLE

    // A capture that ended some other way (Add, the final text, Escape on the card) resets the keys.
    const unsubscribe = useVoiceStore.subscribe((voice) => {
      if (voice.phase === 'idle' || voice.source !== 'shortcut') state = SHORTCUT_IDLE
    })

    const apply = (step: ShortcutStep, event: Event) => {
      state = step.state
      if (step.consume) {
        event.preventDefault()
        event.stopPropagation()
      }
      const voice = useVoiceStore.getState()
      if (step.effect === 'start') voice.begin('shortcut', 'hold')
      else if (step.effect === 'add') voice.finish()
      else if (step.effect === 'cancel') voice.cancel()
      if (state.phase === 'latched') voice.setMode('latched')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Recording a new hotkey in Settings: the keys belong to the recorder.
      if (event.target instanceof Element && event.target.closest('[data-hotkey-recorder]')) return
      const voice = useVoiceStore.getState()
      if (state.phase === 'idle' && voice.phase !== 'idle') {
        // Another capture is on (+ or the palette): the shortcut adds it when nothing is held.
        if (matchesAccelerator(accelerator, event) && !event.repeat) {
          event.preventDefault()
          event.stopPropagation()
          if (voice.mode === 'latched') voice.finish()
        }
        return
      }
      apply(shortcutStep(accelerator, state, { type: 'keydown', at: performance.now(), key: event }), event)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (state.phase === 'idle') return
      apply(shortcutStep(accelerator, state, { type: 'keyup', at: performance.now(), key: event }), event)
    }
    const onBlur = (event: FocusEvent) => apply(shortcutStep(accelerator, state, { type: 'blur' }), event)

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      if (state.phase !== 'idle') useVoiceStore.getState().cancel()
    }
  }, [accelerator])
}
