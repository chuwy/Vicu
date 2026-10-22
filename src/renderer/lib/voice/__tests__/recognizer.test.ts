import { describe, expect, it, vi } from 'vitest'
import { createRecognizer, type RecognizerHandlers, type VoiceBridge } from '../recognizer'
import type { VoiceEventEnvelope } from '../../../../shared/voice-types'

function fakeBridge() {
  let listener: ((envelope: VoiceEventEnvelope) => void) | null = null
  let resolveStart: ((value: Awaited<ReturnType<VoiceBridge['start']>>) => void) | null = null
  const bridge: VoiceBridge & { emit: (envelope: VoiceEventEnvelope) => void; answer: (value: Awaited<ReturnType<VoiceBridge['start']>>) => void } = {
    availability: vi.fn(async () => ({ available: true, engine: 'macos-speech' as const, onDevice: true })),
    start: vi.fn(() => new Promise<Awaited<ReturnType<VoiceBridge['start']>>>((resolve) => { resolveStart = resolve })),
    stop: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    onEvent: (cb) => { listener = cb; return () => { listener = null } },
    emit: (envelope) => listener?.(envelope),
    answer: (value) => resolveStart?.(value),
  }
  return bridge
}

function handlers() {
  const log: string[] = []
  const h: RecognizerHandlers = {
    onReady: () => log.push('ready'),
    onPartial: (text) => log.push(`partial:${text}`),
    onFinal: (text) => log.push(`final:${text}`),
    onError: (code, message) => log.push(`error:${code}:${message}`),
  }
  return { h, log }
}

describe('recognizer', () => {
  it('delivers the session events, including those that came before the start answered', async () => {
    const bridge = fakeBridge()
    const recognizer = createRecognizer(bridge, () => 'en-GB')
    const { h, log } = handlers()
    const started = recognizer.start(h)
    bridge.emit({ sessionId: 4, event: { type: 'ready' } })
    bridge.answer({ success: true, sessionId: 4 })
    expect(await started).toBe(true)
    expect(bridge.start).toHaveBeenCalledWith({ locale: 'en-GB' })
    bridge.emit({ sessionId: 3, event: { type: 'partial', text: 'old session' } })
    bridge.emit({ sessionId: 4, event: { type: 'partial', text: 'Call mom' } })
    bridge.emit({ sessionId: 4, event: { type: 'final', text: 'Call mom tomorrow' } })
    bridge.emit({ sessionId: 4, event: { type: 'partial', text: 'late' } })
    expect(log).toEqual(['ready', 'partial:Call mom', 'final:Call mom tomorrow'])
  })

  it('reports a start that failed', async () => {
    const bridge = fakeBridge()
    const recognizer = createRecognizer(bridge)
    const { h, log } = handlers()
    const started = recognizer.start(h)
    bridge.answer({ success: false, code: 'unsupported', error: 'Not here' })
    expect(await started).toBe(false)
    expect(log).toEqual(['error:unsupported:Not here'])
  })

  it('stop before the start answered goes to main without an id', async () => {
    const bridge = fakeBridge()
    const recognizer = createRecognizer(bridge)
    const { h } = handlers()
    void recognizer.start(h)
    recognizer.stop()
    expect(bridge.stop).toHaveBeenCalledWith(undefined)
  })

  it('cancel while starting lets go of the session main started, and reports nothing', async () => {
    const bridge = fakeBridge()
    const recognizer = createRecognizer(bridge)
    const { h, log } = handlers()
    const started = recognizer.start(h)
    recognizer.cancel()
    bridge.answer({ success: true, sessionId: 9 })
    expect(await started).toBe(false)
    expect(bridge.cancel).toHaveBeenLastCalledWith(9)
    bridge.emit({ sessionId: 9, event: { type: 'final', text: 'x' } })
    expect(log).toEqual([])
  })

  it('cancel after the start sends the session id', async () => {
    const bridge = fakeBridge()
    const recognizer = createRecognizer(bridge)
    const { h } = handlers()
    const started = recognizer.start(h)
    bridge.answer({ success: true, sessionId: 2 })
    await started
    recognizer.cancel()
    expect(bridge.cancel).toHaveBeenCalledWith(2)
  })
})
