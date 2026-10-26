import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadSpeechNative, speechLibraryPath, VS_ENGINE_WHISPER } from '../ai/speech/native'
import { SpeechEngine, SpeechSession } from '../ai/speech/engine'
import type { SpeechEvent } from '../../shared/ai/types'

// A real run of the local speech engine (docs/ai-assistant-v1.md section 3) through the same code
// the app uses: koffi, the Silero detector, the phrase cutter and Whisper. It needs the library
// (npm run speech:lib) and a model, so it runs only when asked:
//
//   VICU_SPEECH_SMOKE_WAV=<16 kHz mono 16-bit wav> VICU_SPEECH_SMOKE_MODEL=<ggml model> npx vitest run ai-speech-native-smoke
//
// whisper.cpp's samples/jfk.wav with ggml-base-q5_1.bin gives the JFK sentence.
const root = join(__dirname, '..', '..', '..')
const wav = process.env.VICU_SPEECH_SMOKE_WAV
const model = process.env.VICU_SPEECH_SMOKE_MODEL
const library = speechLibraryPath(join(root, 'resources'))
const enabled = !!wav && !!model && existsSync(library)

function readWav(path: string): Float32Array {
  const buffer = readFileSync(path)
  let offset = 12
  while (offset < buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') {
      const data = buffer.subarray(offset + 8, offset + 8 + size)
      const samples = new Float32Array(data.length / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
      return samples
    }
    offset += 8 + size
  }
  throw new Error('no data chunk')
}

describe.skipIf(!enabled)('local speech, real engine', () => {
  it('cuts and transcribes a recording fed in 100 ms blocks, then closes every handle', async () => {
    const native = loadSpeechNative(library)!
    expect(native.version()).toBe('1.9.5')
    const engine = new SpeechEngine(native, join(root, 'native', 'speech', 'models', 'ggml-silero-v6.2.0.bin'))
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: model!, engine: VS_ENGINE_WHISPER, language: 'auto', hint: 'Inbox, Vikunja.' }, (e) => events.push(e))
    session.start()
    const samples = readWav(wav!)
    // A second of silence after the speech, as when someone stops talking before letting go.
    const padded = new Float32Array(samples.length + 16000)
    padded.set(samples)
    for (let i = 0; i < padded.length; i += 1600) session.addAudio(padded.slice(i, i + 1600))
    await session.stop()
    const final = events.at(-1)
    console.log('[smoke] events:', JSON.stringify(events.map((e) => e.type)), 'final:', JSON.stringify(final))
    expect(final?.type).toBe('final')
    expect((final as { text: string }).text.toLowerCase().replace(/[^a-z ]/g, '')).toContain('ask not what your country can do for you')
    await engine.closeAll()
  }, 120_000)
})
