import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecognizerHandlers, RecognizerStartOptions, VoiceRecognizer } from '../../voice/recognizer'
import {
  cancelOpenMic,
  openMicVoice,
  setOpenMicRecognizer,
  startOpenMic,
  stopOpenMic,
  useOpenMicStore,
  type OpenMicClient,
} from '../open-mic'

// The open microphone's controller (docs/ai-assistant-v1.md section 3.7) against a fake recogniser:
// turns reach the owner, talking again cancels the running request, the voice pauses it.

function fakeRecognizer() {
  const sessions: Array<{ handlers: RecognizerHandlers; options?: RecognizerStartOptions }> = []
  const log: string[] = []
  const recognizer: VoiceRecognizer = {
    availability: async () => ({ available: true, engine: 'local-speech', onDevice: true }),
    start: async (handlers, options) => {
      sessions.push({ handlers, options })
      log.push('start')
      return true
    },
    stop: () => { log.push('stop') },
    cancel: () => { log.push('cancel') },
  }
  return { recognizer, sessions, log, last: () => sessions[sessions.length - 1].handlers }
}

function client() {
  const turns: string[] = []
  const finish: Array<() => void> = []
  let interrupts = 0
  let offs = 0
  const value: OpenMicClient = {
    onTurn: (text) => {
      turns.push(text)
      return new Promise<void>((resolve) => finish.push(resolve))
    },
    onInterrupt: () => { interrupts++ },
    onOff: () => { offs++ },
  }
  return { value, turns, finish, interrupts: () => interrupts, offs: () => offs }
}

describe('open microphone controller', () => {
  let fake: ReturnType<typeof fakeRecognizer>

  beforeEach(() => {
    vi.useFakeTimers()
    fake = fakeRecognizer()
    setOpenMicRecognizer(fake.recognizer)
  })

  afterEach(() => {
    cancelOpenMic()
    setOpenMicRecognizer(null)
    vi.useRealTimers()
  })

  it('starts the recogniser as an open microphone and hands each turn to the owner', async () => {
    const owner = client()
    startOpenMic('dictation', owner.value)
    expect(fake.sessions[0].options).toEqual({ openMic: true })
    expect(useOpenMicStore.getState()).toMatchObject({ owner: 'dictation', status: 'starting' })
    fake.last().onReady({ turns: true })
    expect(useOpenMicStore.getState().status).toBe('listening')
    fake.last().onSpeech?.()
    fake.last().onPartial('buy milk', 'buy milk')
    expect(useOpenMicStore.getState().words).toBe('buy milk')
    fake.last().onTurn?.('buy milk')
    expect(owner.turns).toEqual(['buy milk'])
    expect(useOpenMicStore.getState().words).toBe('')
  })

  it('cancels the running request when the person talks again, and sends both together', async () => {
    const owner = client()
    startOpenMic('ask', owner.value)
    fake.last().onReady({ turns: true })
    fake.last().onSpeech?.()
    fake.last().onTurn?.('what is due')
    fake.last().onSpeech?.()
    expect(owner.interrupts()).toBe(1)
    fake.last().onTurn?.('this week')
    expect(owner.turns).toEqual(['what is due', 'what is due this week'])
  })

  it('a platform recogniser: words unchanged for end_of_turn_ms end the turn', async () => {
    const owner = client()
    startOpenMic('dictation', owner.value)
    fake.last().onReady()
    fake.last().onPartial('call mum')
    await vi.advanceTimersByTimeAsync(1200)
    expect(owner.turns).toEqual(['call mum'])
  })

  it('pauses for the voice and listens again in a new session after it', async () => {
    const owner = client()
    startOpenMic('ask', owner.value)
    fake.last().onReady({ turns: true })
    openMicVoice(true)
    expect(useOpenMicStore.getState().status).toBe('paused')
    expect(fake.log).toEqual(['start', 'cancel'])
    openMicVoice(false)
    expect(fake.sessions).toHaveLength(2)
    expect(useOpenMicStore.getState().status).toBe('starting')
  })

  it('Done stops the recogniser, sends its last words, then goes off', async () => {
    const owner = client()
    startOpenMic('dictation', owner.value)
    fake.last().onReady({ turns: true })
    fake.last().onSpeech?.()
    stopOpenMic()
    expect(fake.log).toContain('stop')
    expect(useOpenMicStore.getState().status).toBe('stopping')
    fake.last().onFinal('buy milk and eggs', 'and eggs')
    expect(owner.turns).toEqual(['and eggs'])
    expect(useOpenMicStore.getState()).toMatchObject({ owner: null, status: 'off' })
    expect(owner.offs()).toBe(1)
  })

  it('goes off after idle_s without speech', async () => {
    const owner = client()
    startOpenMic('ask', owner.value)
    fake.last().onReady({ turns: true })
    await vi.advanceTimersByTimeAsync(60_000 + 400)
    expect(useOpenMicStore.getState().status).toBe('off')
    expect(owner.offs()).toBe(1)
  })

  it('takes over a running session without restarting it', async () => {
    const owner = client()
    let attached: RecognizerHandlers | null = null
    startOpenMic('dictation', owner.value, { attach: (h) => { attached = h }, ready: true, vad: true, carried: 'buy milk', heard: '', speaking: false })
    expect(fake.sessions).toHaveLength(0)
    expect(owner.turns).toEqual(['buy milk'])
    expect(attached).not.toBeNull()
    expect(useOpenMicStore.getState().status).toBe('listening')
  })
})
