import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import { createLineSplitter, parseHelperLine } from '../voice/helper-protocol'
import { HELPER_STOP_TIMEOUT_MS, runHelperSession, type HelperProcess } from '../voice/helper-session'
import type { VoiceEvent } from '../../shared/voice-types'

describe('speech helper protocol', () => {
  it('reads the event lines', () => {
    expect(parseHelperLine('{"type":"ready"}')).toEqual({ kind: 'event', event: { type: 'ready' } })
    expect(parseHelperLine('{"type":"partial","text":"Call mom"}')).toEqual({ kind: 'event', event: { type: 'partial', text: 'Call mom' } })
    expect(parseHelperLine('{"type":"final","text":"Call mom tomorrow"}\r')).toEqual({ kind: 'event', event: { type: 'final', text: 'Call mom tomorrow' } })
    expect(parseHelperLine('{"type":"error","code":"mic-denied","message":"No"}')).toEqual({
      kind: 'event',
      event: { type: 'error', code: 'mic-denied', message: 'No' },
    })
  })

  it('turns an unknown error code into "failed" and keeps a message', () => {
    expect(parseHelperLine('{"type":"error","code":"weird"}')).toEqual({
      kind: 'event',
      event: { type: 'error', code: 'failed', message: 'Voice input stopped.' },
    })
  })

  it('reads the check line', () => {
    expect(parseHelperLine('{"type":"check","available":true,"onDevice":true,"authorization":"authorized","locale":"en-US"}')).toEqual({
      kind: 'check',
      check: { available: true, onDevice: true, authorization: 'authorized', locale: 'en-US' },
    })
  })

  it('ignores anything that is not a message', () => {
    expect(parseHelperLine('')).toBeNull()
    expect(parseHelperLine('WARNING: something')).toBeNull()
    expect(parseHelperLine('{not json')).toBeNull()
    expect(parseHelperLine('{"type":"other"}')).toBeNull()
    expect(parseHelperLine('[1,2]')).toBeNull()
  })

  it('splits lines across chunks, multi-byte characters included', () => {
    const splitter = createLineSplitter()
    const bytes = Buffer.from('{"type":"partial","text":"Café"}\n{"type":"fin')
    const cut = bytes.indexOf(0xc3) + 1 // inside "é"
    expect(splitter.push(bytes.subarray(0, cut))).toEqual([])
    expect(splitter.push(bytes.subarray(cut))).toEqual(['{"type":"partial","text":"Café"}'])
    expect(splitter.push('al","text":"x"}\r\n')).toEqual(['{"type":"final","text":"x"}'])
    expect(splitter.push('{"type":"ready"}')).toEqual([])
    expect(splitter.flush()).toEqual(['{"type":"ready"}'])
  })
})

class FakeHelper extends EventEmitter implements HelperProcess {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  written: string[] = []
  ended = false
  killed = false
  stdin = {
    write: (data: string) => { this.written.push(data) },
    end: () => { this.ended = true },
    on: () => undefined,
  }
  say(line: string) { this.stdout.emit('data', Buffer.from(`${line}\n`)) }
  exit(code = 0) { this.emit('exit', code) }
  kill() { this.killed = true }
}

function session() {
  const child = new FakeHelper()
  const events: VoiceEvent[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const handle = runHelperSession(child, (event) => events.push(event), {
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
  })
  return { child, events, timers, handle }
}

describe('helper session', () => {
  it('passes partials on and ends with the final text', () => {
    const { child, events, handle } = session()
    child.say('{"type":"ready"}')
    child.say('{"type":"partial","text":"Call"}')
    child.say('{"type":"partial","text":"Call mom"}')
    handle.stop()
    expect(child.written).toEqual(['stop\n'])
    child.say('{"type":"final","text":"Call mom tomorrow"}')
    child.exit()
    expect(events).toEqual([
      { type: 'ready' },
      { type: 'partial', text: 'Call' },
      { type: 'partial', text: 'Call mom' },
      { type: 'final', text: 'Call mom tomorrow' },
    ])
  })

  it('uses what was heard when the helper exits after "stop" without a final line', () => {
    const { child, events, handle } = session()
    child.say('{"type":"partial","text":"Buy milk"}')
    handle.stop()
    child.exit()
    expect(events.at(-1)).toEqual({ type: 'final', text: 'Buy milk' })
  })

  it('does not wait for a helper that never answers "stop"', () => {
    const { child, events, timers, handle } = session()
    child.say('{"type":"partial","text":"Buy milk"}')
    handle.stop()
    const timer = timers.find((t) => t.ms === HELPER_STOP_TIMEOUT_MS)!
    timer.fn()
    expect(events.at(-1)).toEqual({ type: 'final', text: 'Buy milk' })
    expect(child.killed).toBe(true)
    child.exit()
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1)
  })

  it('reports an error line once and nothing after it', () => {
    const { child, events } = session()
    child.say('{"type":"error","code":"speech-denied","message":"Allow it"}')
    child.exit(1)
    expect(events).toEqual([{ type: 'error', code: 'speech-denied', message: 'Allow it' }])
  })

  it('an unexpected exit is an error with the last stderr line', () => {
    const { child, events } = session()
    child.stderr.emit('data', Buffer.from('boom\nreal reason\n'))
    child.exit(6)
    expect(events).toEqual([{ type: 'error', code: 'failed', message: 'Voice input stopped: real reason' }])
  })

  it('a helper that cannot start is an error', () => {
    const { child, events } = session()
    child.emit('error', new Error('ENOENT'))
    expect(events).toEqual([{ type: 'error', code: 'failed', message: 'Voice input could not start: ENOENT' }])
  })

  it('cancel reports nothing more and kills a helper that stays', () => {
    const { child, events, timers, handle } = session()
    child.say('{"type":"partial","text":"Call"}')
    handle.cancel()
    expect(child.written).toEqual(['cancel\n'])
    expect(child.ended).toBe(true)
    child.say('{"type":"final","text":"Call mom"}')
    timers.at(-1)!.fn()
    expect(child.killed).toBe(true)
    child.exit()
    expect(events).toEqual([{ type: 'partial', text: 'Call' }])
  })

  it('does not kill a helper that already left after cancel', () => {
    const { child, timers, handle } = session()
    handle.cancel()
    child.exit()
    timers.at(-1)!.fn()
    expect(child.killed).toBe(false)
  })
})
