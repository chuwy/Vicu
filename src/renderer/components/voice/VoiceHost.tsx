import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Mic } from 'lucide-react'
import { useAppConfig } from '@/hooks/use-app-config'
import { useAddVoiceTask } from '@/hooks/use-add-voice-task'
import { useDateFormat } from '@/hooks/use-date-format'
import { useIsDark } from '@/hooks/use-is-dark'
import { useVoiceShortcut } from '@/hooks/use-voice-shortcut'
import { formatAcceleratorForDisplay } from '@/lib/accelerator'
import { cn } from '@/lib/cn'
import { getParserConfig, parse, type ParsedToken } from '@/lib/task-parser'
import { tokenHighlightBackground } from '@/lib/token-chip-colors'
import { cleanTranscript, voiceCardChips, type VoiceTaskContext } from '@/lib/voice/voice-task'
import { useProjects } from '@/hooks/use-projects'
import { useNewTaskRequestStore } from '@/stores/new-task-request-store'
import { useVoiceStore } from '@/stores/voice-store'
import { Button } from '@/components/shared/Button'
import { TokenChip } from '@/components/task-input/TokenChip'

const isMac = window.api.platform === 'darwin'

/**
 * Voice input in the main window (docs/voice-input.md): the voice shortcut, the floating card
 * while a capture runs, and the add when the final words arrive. Mounted once, in AppShell.
 */
export function VoiceHost() {
  const { data: config } = useAppConfig()
  useVoiceShortcut(config?.voice_hotkey)

  const phase = useVoiceStore((s) => s.phase)
  const finalText = useVoiceStore((s) => s.finalText)
  const fallbackRequest = useVoiceStore((s) => s.fallbackRequest)
  const addVoiceTask = useAddVoiceTask()
  const navigate = useNavigate()

  // The final words: add them once.
  const adding = useRef<string | null>(null)
  useEffect(() => {
    if (phase !== 'adding' || finalText === null || adding.current === finalText) return
    adding.current = finalText
    void addVoiceTask(finalText, useVoiceStore.getState().list).finally(() => {
      adding.current = null
      useVoiceStore.getState().done()
    })
  }, [phase, finalText, addVoiceTask])

  // No speech engine here (Linux): open the composer instead, as the palette's New task does.
  const lastFallback = useRef(fallbackRequest)
  useEffect(() => {
    if (fallbackRequest === lastFallback.current) return
    lastFallback.current = fallbackRequest
    useNewTaskRequestStore.getState().request()
    const timer = setTimeout(() => {
      if (useNewTaskRequestStore.getState().requestedAt !== null) void navigate({ to: '/inbox' })
    }, 80)
    return () => clearTimeout(timer)
  }, [fallbackRequest, navigate])

  // Escape cancels any capture; Enter adds one that is not held.
  useEffect(() => {
    if (phase === 'idle' || phase === 'adding') return
    const onKeyDown = (event: KeyboardEvent) => {
      const voice = useVoiceStore.getState()
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        voice.cancel()
      } else if (event.key === 'Enter' && voice.mode === 'latched' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        voice.finish()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  const parserConfig = useMemo(() => getParserConfig(config ?? {}), [config])
  const { data: projects } = useProjects()
  const list = useVoiceStore((s) => s.list)
  // What the card reads chips with: the same context the add uses.
  const context = useMemo<VoiceTaskContext>(() => ({
    parserConfig,
    projects: projects?.flat ?? [],
    inboxProjectId: config?.inbox_project_id ?? 0,
    list,
  }), [parserConfig, projects?.flat, config?.inbox_project_id, list])
  if (phase === 'idle') return null
  return <VoiceCard hotkey={config?.voice_hotkey} context={context} />
}

interface Segment {
  text: string
  token?: ParsedToken
}

function segmentsOf(text: string, tokens: readonly ParsedToken[]): Segment[] {
  const sorted = [...tokens].sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let pos = 0
  for (const token of sorted) {
    if (token.start < pos) continue
    if (token.start > pos) out.push({ text: text.slice(pos, token.start) })
    out.push({ text: text.slice(token.start, token.end), token })
    pos = token.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}

function VoiceCard({ hotkey, context }: { hotkey?: string; context: VoiceTaskContext }) {
  const phase = useVoiceStore((s) => s.phase)
  const source = useVoiceStore((s) => s.source)
  const mode = useVoiceStore((s) => s.mode)
  const rawText = useVoiceStore((s) => s.text)
  const cancelArmed = useVoiceStore((s) => s.cancelArmed)
  const isDark = useIsDark()
  const dateFormat = useDateFormat()

  const text = cleanTranscript(rawText)
  const parsed = useMemo(() => (text ? parse(text, context.parserConfig) : null), [text, context.parserConfig])
  // The list's date and project show before anything is said: where the task will go.
  const chips = useMemo(() => voiceCardChips(parsed, text, { ...context, now: new Date() }, dateFormat), [parsed, text, context, dateFormat])
  const segments = parsed ? segmentsOf(text, parsed.tokens) : []

  const listening = phase === 'starting' || phase === 'listening'
  const status = phase === 'starting'
    ? 'Starting…'
    : phase === 'finishing' || phase === 'adding'
      ? 'Adding…'
      : cancelArmed ? 'Release to cancel' : 'Listening…'

  const shortcutName = hotkey ? formatAcceleratorForDisplay(hotkey, isMac) : ''
  const hint = cancelArmed
    ? 'Move back to keep it · Esc to cancel'
    : mode === 'latched'
    ? `${source === 'shortcut' && shortcutName ? `${shortcutName} or Enter` : 'Enter'} to add · Esc to cancel`
    : source === 'button'
      ? 'Release to add · Esc to cancel'
      : 'Let go to add · Esc to cancel'

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] flex justify-center px-4">
      <section
        role="dialog"
        aria-modal="false"
        aria-label="Say a task"
        data-voice-card=""
        data-phase={phase}
        data-cancel-armed={cancelArmed ? '' : undefined}
        className={cn(
          'vicu-voice-card pointer-events-auto w-full max-w-md rounded-card border bg-[var(--bg-primary)] p-4 shadow-lg',
          cancelArmed ? 'border-danger/60' : 'border-[var(--border-color)]',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
            {listening && !cancelArmed && <span className="vicu-voice-pulse absolute inset-0 rounded-full bg-accent-blue/25" />}
            <span
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-full',
                cancelArmed ? 'bg-danger text-on-accent dark:text-bg-page' : 'bg-accent-fill text-on-accent',
              )}
            >
              <Mic className="h-4 w-4" />
            </span>
          </div>

          {/* One token scope: a chip travels out of its highlighted words (TokenChip). */}
          <div className="min-w-0 flex-1" data-token-scope="">
            <p className={cn('text-meta font-medium', cancelArmed ? 'text-danger' : 'text-[var(--text-secondary)]')}>{status}</p>
            <p className="mt-1 min-h-6 break-words text-task-title text-[var(--text-primary)]">
              {segments.length > 0 ? (
                segments.map((segment, i) =>
                  segment.token ? (
                    <span
                      key={i}
                      data-token-type={segment.token.type}
                      className="rounded-chip"
                      style={{ background: tokenHighlightBackground(segment.token.type, isDark) }}
                    >
                      {segment.text}
                    </span>
                  ) : (
                    <span key={i}>{segment.text}</span>
                  ),
                )
              ) : (
                <span className="text-[var(--text-secondary)]">Say a task, like “Call mom tomorrow 3pm”</span>
              )}
            </p>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <TokenChip key={chip.key} type={chip.type} label={chip.label} source={chip.source} priority={chip.priority} />
                ))}
              </div>
            )}
            <p className="mt-2 text-caption text-[var(--text-secondary)]">{hint}</p>
          </div>
        </div>

        {mode === 'latched' && (phase === 'starting' || phase === 'listening') && (
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="quiet" onClick={() => useVoiceStore.getState().cancel()}>Cancel</Button>
            <Button variant="primary" onClick={() => useVoiceStore.getState().finish()}>Add</Button>
          </div>
        )}
      </section>
    </div>
  )
}
