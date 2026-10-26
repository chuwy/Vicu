import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAiSettings, useAiWorkspace, SPEECH_STATUS_QUERY_KEY, AI_SETTINGS_QUERY_KEY } from '@/hooks/use-ai'
import { hintFor } from '@/lib/ai/workspace'
import { setSpeechStartOptions } from '@/lib/ai/recognizers'

/**
 * Keeps the assistant's window-side state current (docs/ai-assistant-v1.md section 3): local
 * speech's language setting and vocabulary hint (3.4), read when each recording starts, and the
 * speech status while a model downloads. Renders nothing.
 */
export function AiHost() {
  const ws = useAiWorkspace()
  const { data: settings } = useAiSettings()
  const qc = useQueryClient()
  const live = useRef({ ws, language: settings?.speech.language ?? 'auto' })
  live.current = { ws, language: settings?.speech.language ?? 'auto' }

  useEffect(() => {
    setSpeechStartOptions(() => ({ language: live.current.language, hint: hintFor(live.current.ws) }))
  }, [])

  useEffect(() => window.api.speech.onDownloadProgress((progress) => {
    if (progress.done || progress.error) {
      void qc.invalidateQueries({ queryKey: SPEECH_STATUS_QUERY_KEY })
      void qc.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY })
    }
  }), [qc])

  return null
}
