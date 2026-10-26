import { describe, expect, it } from 'vitest'
import { SPEECH } from '../contract'
import { OpenMic, VadTurnTracker, joinWords, openMicSettings, vadTurnSettings, wordsAfter, type OpenMicEffect } from '../turns'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 3.7: turns, interrupting, the voice, and the microphone going off.

const END = 1000
const IDLE = 60_000
const settings = { endOfTurnMs: END, idleMs: IDLE }
const sends = (effects: OpenMicEffect[]) => effects.filter((e) => e.type === 'send').map((e) => (e as { text: string }).text)
const types = (effects: OpenMicEffect[]) => effects.map((e) => e.type)

describe('turn settings', () => {
  it('come from the fixture', () => {
    expect(SPEECH.turn).toEqual(aiFixture.speech.turn)
    expect(openMicSettings()).toEqual({ endOfTurnMs: aiFixture.speech.turn.end_of_turn_ms, idleMs: aiFixture.speech.turn.idle_s * 1000 })
    // A brain dump (4.8) listens longer before it turns off.
    expect(openMicSettings(true)).toEqual({ endOfTurnMs: aiFixture.speech.turn.end_of_turn_ms, idleMs: aiFixture.speech.turn.dump_idle_s * 1000 })
    expect(vadTurnSettings()).toEqual({
      threshold: aiFixture.speech.vad.threshold,
      minSpeechMs: aiFixture.speech.vad.min_speech_ms,
      minSilenceMs: aiFixture.speech.vad.min_silence_ms,
      endOfTurnMs: aiFixture.speech.turn.end_of_turn_ms,
    })
  })
})

describe('turns from the voice detector', () => {
  const tracker = () => new VadTurnTracker({ threshold: 0.5, minSpeechMs: 250, minSilenceMs: 600, endOfTurnMs: 1000 }, 32)
  const windows = (count: number, probability: number) => Array.from({ length: count }, () => probability)

  it('says speech once a turn has min_speech_ms of it, and ends the turn after end_of_turn_ms of pause', () => {
    const t = tracker()
    expect(t.push(windows(7, 0.9))).toEqual([])
    expect(t.push(windows(1, 0.9))).toEqual(['speech'])
    expect(t.push(windows(20, 0.9))).toEqual([])
    // A pause shorter than the turn end (a phrase may end here) keeps the turn.
    expect(t.push(windows(25, 0.1))).toEqual([])
    expect(t.push(windows(10, 0.9))).toEqual([])
    expect(t.push(windows(31, 0.1))).toEqual([])
    expect(t.push(windows(1, 0.1))).toEqual(['end'])
    expect(t.speaking).toBe(false)
    expect(t.push(windows(100, 0.1))).toEqual([])
  })

  it('forgets a blip shorter than min_speech_ms after min_silence_ms: no speech, no turn', () => {
    const t = tracker()
    expect(t.push([...windows(5, 0.9), ...windows(19, 0.1)])).toEqual([])
    // 5 more windows would make 10 with the blip; after the silence they count from zero.
    expect(t.push(windows(5, 0.9))).toEqual([])
    expect(t.push(windows(40, 0.1))).toEqual([])
  })

  it('ends a turn on demand only when it has speech', () => {
    const t = tracker()
    expect(t.forceEnd()).toEqual([])
    t.push(windows(10, 0.9))
    expect(t.forceEnd()).toEqual(['end'])
    expect(t.speaking).toBe(false)
  })
})

describe('words of a platform recogniser', () => {
  it('cuts the words after the last turn', () => {
    expect(wordsAfter('', 'buy milk')).toBe('buy milk')
    expect(wordsAfter('buy milk', 'buy milk and eggs')).toBe('and eggs')
    expect(wordsAfter('Buy milk', 'buy milk  and eggs ')).toBe('and eggs')
  })

  it('skips as many words when earlier ones were corrected, and takes all after a restart', () => {
    expect(wordsAfter('by milk', 'buy milk tomorrow')).toBe('tomorrow')
    expect(wordsAfter('buy milk tomorrow', 'call mum')).toBe('call mum')
    expect(wordsAfter('buy milk', 'buy milk')).toBe('')
  })

  it('joins pieces with one space', () => {
    expect(joinWords(' buy milk ', 'and eggs')).toBe('buy milk and eggs')
    expect(joinWords('', 'and eggs')).toBe('and eggs')
    expect(joinWords('buy milk', ' ')).toBe('buy milk')
  })
})

describe('open microphone with local speech (turns from the voice detector)', () => {
  const started = (at = 0) => {
    const mic = new OpenMic(settings)
    mic.start(at, { vad: true })
    return mic
  }

  it('sends each turn when it ends, and shows its words while heard', () => {
    const mic = started()
    expect(mic.speech(100)).toEqual([])
    mic.heard(900, 'buy milk')
    expect(mic.words).toBe('buy milk')
    expect(mic.hearing).toBe(true)
    expect(mic.turn(2000, 'buy milk')).toEqual([{ type: 'send', id: 1, text: 'buy milk' }])
    expect(mic.words).toBe('')
    expect(mic.requestRunning).toBe(true)
    mic.done(2500, 1)
    expect(mic.requestRunning).toBe(false)
  })

  it('cancels the running request when the person talks again and sends both turns together', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1500, 'buy milk')
    expect(mic.speech(1800)).toEqual([{ type: 'cancel', id: 1 }])
    // What is shown keeps the cancelled words in front.
    mic.heard(2600, 'and eggs')
    expect(mic.words).toBe('buy milk and eggs')
    expect(sends(mic.turn(3500, 'and eggs'))).toEqual(['buy milk and eggs'])
    // The cancelled request finishing late changes nothing.
    mic.done(3600, 1)
    expect(mic.requestRunning).toBe(true)
  })

  it('keeps a finished answer: talking afterwards is just the next turn', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1500, 'what is due today')
    mic.done(4000, 1)
    expect(mic.speech(5000)).toEqual([])
    expect(sends(mic.turn(6500, 'and tomorrow'))).toEqual(['and tomorrow'])
  })

  it('does not interrupt while a card waits: the words answer it', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1500, 'mark groceries done')
    mic.setInterruptible(false)
    expect(mic.speech(3000)).toEqual([])
    expect(mic.turn(3800, 'yes')).toEqual([{ type: 'send', id: 2, text: 'yes' }])
  })

  it('replaces a running request when a turn ends without a speech signal first', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1500, 'buy milk')
    expect(mic.turn(2600, 'and eggs')).toEqual([{ type: 'cancel', id: 1 }, { type: 'send', id: 2, text: 'buy milk and eggs' }])
  })

  it('sends nothing for a turn without words, unless it carries interrupted words', () => {
    const mic = started()
    mic.speech(0)
    expect(mic.turn(1200, '  ')).toEqual([])
    mic.speech(2000)
    mic.turn(3000, 'buy milk')
    mic.speech(3200)
    expect(sends(mic.turn(4300, ''))).toEqual(['buy milk'])
  })

  it('pauses for the voice, drops what it heard, and listens again when the voice ends', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1500, 'what is due')
    mic.done(3000, 1)
    expect(mic.voice(3000, true)).toEqual([{ type: 'pause' }])
    expect(mic.phase).toBe('paused')
    expect(mic.speech(3500)).toEqual([])
    expect(mic.turn(4000, 'echo of the answer')).toEqual([])
    expect(mic.voice(6000, false)).toEqual([{ type: 'listen' }])
    expect(mic.phase).toBe('listening')
  })

  it('turns off after idle_s without speech, counted from the last answer, never while a request runs', () => {
    const mic = started(0)
    expect(mic.tick(IDLE - 1)).toEqual([])
    mic.speech(IDLE - 1)
    mic.turn(IDLE + 1000, 'buy milk')
    expect(mic.tick(IDLE * 3)).toEqual([])
    mic.done(IDLE * 3, 1)
    expect(mic.tick(IDLE * 4 - 1)).toEqual([])
    expect(mic.tick(IDLE * 4)).toEqual([{ type: 'off' }])
    expect(mic.phase).toBe('off')
  })

  it('a brain dump turns off after dump_idle_s instead, also when switched on while listening', () => {
    const dumpIdle = aiFixture.speech.turn.dump_idle_s * 1000
    const dumping = new OpenMic({ ...settings, idleMs: dumpIdle })
    dumping.start(0, { vad: true })
    expect(dumping.tick(IDLE * 2)).toEqual([])
    expect(dumping.tick(dumpIdle)).toEqual([{ type: 'off' }])

    const mic = started(0)
    mic.setIdleMs(dumpIdle)
    expect(mic.tick(IDLE)).toEqual([])
    mic.setIdleMs(IDLE)
    expect(mic.tick(IDLE + 1)).toEqual([{ type: 'off' }])
  })

  it('stopping sends the last words, then goes off', () => {
    const mic = started()
    mic.speech(0)
    expect(mic.stop(500)).toEqual([{ type: 'finish' }])
    expect(mic.phase).toBe('stopping')
    expect(mic.final(900, 'call mum')).toEqual([{ type: 'send', id: 1, text: 'call mum' }, { type: 'off' }])
  })

  it('listens again when the recogniser ends its utterance by itself', () => {
    const mic = started()
    mic.speech(0)
    expect(types(mic.final(600_000, 'a long ramble'))).toEqual(['send', 'listen'])
    expect(mic.phase).toBe('listening')
  })

  it('stopped while paused: only carried words go out', () => {
    const mic = started()
    mic.speech(0)
    mic.turn(1000, 'buy milk')
    mic.speech(1200)
    mic.voice(1300, true)
    expect(mic.stop(1400)).toEqual([{ type: 'send', id: 2, text: 'buy milk' }, { type: 'off' }])
  })
})

describe('open microphone with a platform recogniser (turns from its words)', () => {
  it('starts a turn with the first words and ends it when they have not changed for end_of_turn_ms', () => {
    const mic = new OpenMic(settings)
    mic.start(0)
    mic.session(false)
    expect(mic.heard(200, 'buy')).toEqual([])
    expect(mic.hearing).toBe(true)
    mic.heard(600, 'buy milk')
    expect(mic.tick(1599)).toEqual([])
    expect(mic.tick(1600)).toEqual([{ type: 'send', id: 1, text: 'buy milk' }])
    // The recogniser keeps its whole text: the next turn is what comes after it.
    expect(mic.heard(2000, 'buy milk and')).toEqual([{ type: 'cancel', id: 1 }])
    mic.heard(2300, 'buy milk and eggs')
    expect(mic.words).toBe('buy milk and eggs')
    expect(mic.tick(3300)).toEqual([{ type: 'send', id: 2, text: 'buy milk and eggs' }])
  })

  it('ends a turn when the recogniser ends its utterance, and a new session starts from nothing', () => {
    const mic = new OpenMic(settings)
    mic.start(0)
    mic.session(false)
    mic.heard(100, 'buy milk')
    mic.tick(1200)
    mic.done(1500, 1)
    mic.heard(1800, 'buy milk call mum')
    expect(mic.final(2000, 'buy milk call mum')).toEqual([{ type: 'send', id: 2, text: 'call mum' }, { type: 'listen' }])
    mic.done(2200, 2)
    mic.session(false)
    mic.heard(2600, 'pay rent')
    expect(mic.words).toBe('pay rent')
  })
})

describe('open microphone taking over a quick capture (smart dictation locked)', () => {
  it('sends the words heard before the lock at once when nobody is talking', () => {
    const mic = new OpenMic(settings)
    expect(mic.start(0, { vad: true, carried: 'buy milk' })).toEqual([{ type: 'send', id: 1, text: 'buy milk' }])
  })

  it('lets a turn being heard end first, with the earlier words in front', () => {
    const mic = new OpenMic(settings)
    expect(mic.start(0, { vad: true, carried: 'buy milk', heard: 'and', speaking: true })).toEqual([])
    expect(mic.words).toBe('buy milk and')
    expect(sends(mic.turn(800, 'and eggs'))).toEqual(['buy milk and eggs'])
  })

  it('a platform recogniser: its whole text so far is the current turn', () => {
    const mic = new OpenMic(settings)
    expect(mic.start(0, { vad: false, heard: 'buy milk' })).toEqual([])
    mic.heard(300, 'buy milk and eggs')
    expect(mic.tick(1300)).toEqual([{ type: 'send', id: 1, text: 'buy milk and eggs' }])
  })

  it('cancel drops everything and goes off', () => {
    const mic = new OpenMic(settings)
    mic.start(0, { vad: true, heard: 'buy', speaking: true })
    expect(mic.cancel()).toEqual([{ type: 'off' }])
    expect(mic.words).toBe('')
    expect(mic.cancel()).toEqual([])
  })
})
