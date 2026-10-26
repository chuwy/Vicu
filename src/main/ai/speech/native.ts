import { existsSync } from 'fs'
import { join } from 'path'

// The local speech engine (native/speech/vicu_speech.h over whisper.cpp; docs/ai-assistant-v1.md
// section 3), loaded with koffi. Built by scripts/build-speech.mjs into resources/speech/.
//
// Every call that may take long (opening a model, transcribing) runs on koffi's worker threads
// (`.async`), so the main process never blocks. One handle is used by one thread at a time: the
// callers (speech/engine.ts) chain the calls of each handle. Every handle must be closed before the
// app quits, or ggml's Metal teardown asserts (closeAll in engine.ts runs at will-quit).

export const VS_ENGINE_WHISPER = 0
export const VS_ENGINE_PARAKEET = 1

/** An opaque native handle (a koffi pointer). */
export type NativeHandle = { readonly __native: unique symbol } | object

export interface SpeechNative {
  version(): string
  vadWindowSamples(): number
  vadOpen(path: string, threads: number): NativeHandle | null
  /** One speech probability per whole window of 512 samples; the rest is kept for the next call. */
  vadFeed(vad: NativeHandle, samples: Float32Array): number[]
  vadReset(vad: NativeHandle): void
  vadClose(vad: NativeHandle): void
  modelOpen(path: string, engine: number, useGpu: boolean): Promise<NativeHandle | null>
  transcribe(model: NativeHandle, samples: Float32Array, language: string | null, prompt: string | null, threads: number): Promise<string | null>
  abort(model: NativeHandle): void
  modelClose(model: NativeHandle): void
}

const MAX_TEXT_BYTES = 64 * 1024

export function speechLibraryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'libvicu_speech.dylib' : platform === 'win32' ? 'vicu_speech.dll' : 'libvicu_speech.so'
}

/** Where the library is: resources/speech/ next to app.asar when packaged, the repo's resources/ in development. */
export function speechLibraryPath(resourcesRoot: string, platform: NodeJS.Platform = process.platform): string {
  return join(resourcesRoot, 'speech', speechLibraryName(platform))
}

function promisify<T>(fn: { async: (...args: unknown[]) => void }, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: unknown, result: T) => (err ? reject(err) : resolve(result)))
  })
}

/** Loads the library, or null when it is not part of this build (the platform recogniser is used then). */
export function loadSpeechNative(libraryPath: string): SpeechNative | null {
  if (!existsSync(libraryPath)) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const lib = koffi.load(libraryPath)
  const fVersion = lib.func('const char *vs_version(void)')
  const fWindow = lib.func('int vs_vad_window_samples(void)')
  const fVadOpen = lib.func('void *vs_vad_open(const char *path, int n_threads)')
  const fVadFeed = lib.func('int vs_vad_feed(void *vad, const float *samples, int n_samples, _Out_ float *out_probs, int max_probs)')
  const fVadReset = lib.func('void vs_vad_reset(void *vad)')
  const fVadClose = lib.func('void vs_vad_close(void *vad)')
  const fModelOpen = lib.func('void *vs_model_open(const char *path, int engine, int use_gpu)')
  const fTranscribe = lib.func('int vs_transcribe(void *model, const float *samples, int n_samples, const char *language, const char *prompt, int n_threads, _Out_ uint8_t *out, int max_out)')
  const fAbort = lib.func('void vs_abort(void *model)')
  const fModelClose = lib.func('void vs_model_close(void *model)')

  return {
    version: () => String(fVersion()),
    vadWindowSamples: () => Number(fWindow()),
    vadOpen: (path, threads) => (fVadOpen(path, threads) as NativeHandle | null) ?? null,
    vadFeed: (vad, samples) => {
      const max = Math.floor(samples.length / 512) + 2
      const probs = new Float32Array(max)
      const n = Number(fVadFeed(vad, samples, samples.length, probs, max))
      if (n < 0) throw new Error('The voice detector failed.')
      return Array.from(probs.subarray(0, n))
    },
    vadReset: (vad) => { fVadReset(vad) },
    vadClose: (vad) => { fVadClose(vad) },
    modelOpen: async (path, engine, useGpu) => (await promisify<NativeHandle | null>(fModelOpen, path, engine, useGpu ? 1 : 0)) ?? null,
    transcribe: async (model, samples, language, prompt, threads) => {
      const out = Buffer.alloc(MAX_TEXT_BYTES)
      const n = await promisify<number>(fTranscribe, model, samples, samples.length, language, prompt, threads, out, out.length)
      if (n < 0) return null
      return out.subarray(0, n).toString('utf8')
    },
    abort: (model) => { fAbort(model) },
    modelClose: (model) => { fModelClose(model) },
  }
}
