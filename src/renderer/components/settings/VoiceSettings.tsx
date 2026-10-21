import { useEffect, useState } from 'react'
import { HotkeyRecorder } from './HotkeyRecorder'
import type { AppConfig } from '@/lib/vikunja-types'
import { voiceHotkeyConflict } from '@/lib/voice/shortcut-conflicts'
import type { VoiceAvailability } from '../../../shared/voice-types'

const isMac = window.api.platform === 'darwin'
/** The same as DEFAULT_VOICE_HOTKEY in src/main/config.ts. */
const DEFAULT_VOICE_HOTKEY = isMac ? 'Command+Shift+D' : 'Ctrl+Shift+D'

interface VoiceSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

function engineText(availability: VoiceAvailability | null): string {
  if (!availability) return 'Checking voice input…'
  if (!availability.available) return availability.reason ?? 'Voice input is not available on this system.'
  const engine = availability.engine === 'macos-speech' ? 'macOS speech recognition' : 'Windows speech recognition'
  return availability.onDevice
    ? `Uses ${engine}, on this computer: what you say is not sent anywhere.`
    : `Uses ${engine}. Your language is recognized by Apple's servers.`
}

/** Settings, Keyboard Shortcuts: the in-app voice shortcut (docs/voice-input.md). */
export function VoiceSettings({ config, onChange }: VoiceSettingsProps) {
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null)
  useEffect(() => {
    let live = true
    window.api.voice.availability().then((value) => { if (live) setAvailability(value) }).catch(() => {
      if (live) setAvailability({ available: false, engine: 'none', onDevice: false })
    })
    return () => { live = false }
  }, [])

  const hotkey = config.voice_hotkey ?? DEFAULT_VOICE_HOTKEY
  const conflict = voiceHotkeyConflict(hotkey, config, isMac)

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Voice input</h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Hold the + button, or hold the shortcut below, and say a task such as “Call mom tomorrow 3pm”. Let go to add it, press Esc to cancel. Tap the shortcut instead to keep listening until you press it again or Enter. “Say a task” in the command palette does the same.
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]" data-voice-engine="">{engineText(availability)}</p>

      <div className="mt-4">
        <label className="mb-1 block text-xs text-[var(--text-secondary)]">Shortcut (while Vicu is in front)</label>
        <HotkeyRecorder
          value={hotkey}
          onChange={(value) => onChange({ voice_hotkey: value })}
          onClear={() => onChange({ voice_hotkey: '' })}
          defaultValue={DEFAULT_VOICE_HOTKEY}
          emptyText="Off"
          label="Voice input shortcut"
          warning={conflict !== null}
        />
        {conflict && <p className="mt-1 text-xs text-status-today">{conflict}</p>}
      </div>
    </div>
  )
}
