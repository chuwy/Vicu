import { app, type WebContents } from 'electron'
import { join } from 'path'
import { SPEECH, speechModel, type SpeechModelInfo } from '../../../shared/ai/contract'
import type { SpeechDownloadProgress, SpeechEvent, SpeechStartOptions, SpeechStatus } from '../../../shared/ai/types'
import { sendToAppWindows } from '../../offline/service'
import { ensureMicrophone, MIC_DENIED_REASON } from '../../voice/service'
import { getAiSettings, patchAiSettings } from '../settings-store'
import { deleteModelFiles, downloadModel, isDownloaded, modelFilePath, partialBytes, type FetchLike } from './downloads'
import { SpeechEngine, SpeechSession } from './engine'
import { loadSpeechNative, speechLibraryPath, VS_ENGINE_PARAKEET, VS_ENGINE_WHISPER } from './native'

// Local speech for the windows (docs/ai-assistant-v1.md section 3): one recording at a time, fed
// with 16 kHz mono audio by the window that started it (`speech:audio`), events back as
// `speech:event`; the model files and their downloads. The engine library comes from
// resources/speech/ (scripts/build-speech.mjs), the Silero model from native/speech/models (shipped
// as speech-models/ next to app.asar).

function resourcesRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

function vadModelPath(): string {
  const file = SPEECH.vad.model.file
  return app.isPackaged ? join(process.resourcesPath, 'speech-models', file) : join(app.getAppPath(), 'native', 'speech', 'models', file)
}

export function speechModelsDir(): string {
  return join(app.getPath('userData'), 'speech-models')
}

let engine: SpeechEngine | null | undefined

function getEngine(): SpeechEngine | null {
  if (engine !== undefined) return engine
  try {
    const native = loadSpeechNative(speechLibraryPath(resourcesRoot()))
    engine = native ? new SpeechEngine(native, vadModelPath()) : null
  } catch (err) {
    console.warn('[Speech] The speech engine could not be loaded:', err instanceof Error ? err.message : err)
    engine = null
  }
  return engine
}

function engineAvailable(): boolean {
  return getEngine() !== null
}

/** The model local speech uses: the chosen one when it is downloaded. */
function activeModel(): SpeechModelInfo | null {
  const id = getAiSettings().speech.modelId
  const model = id ? speechModel(id) : undefined
  return model && isDownloaded(speechModelsDir(), model) ? model : null
}

const downloads = new Map<string, { controller: AbortController; progress: number; error?: string }>()
const downloadErrors = new Map<string, string>()

export function speechStatus(): SpeechStatus {
  const dir = speechModelsDir()
  return {
    engine: engineAvailable(),
    models: SPEECH.models.map((model) => {
      const running = downloads.get(model.id)
      return {
        id: model.id,
        downloaded: isDownloaded(dir, model),
        downloadedBytes: running ? running.progress : partialBytes(dir, model),
        downloading: !!running,
        ...(downloadErrors.has(model.id) ? { error: downloadErrors.get(model.id) } : {}),
      }
    }),
    activeModelId: engineAvailable() ? activeModel()?.id ?? null : null,
  }
}

let fetchImpl: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>

/** Test hook. */
export function setSpeechFetch(next: FetchLike | null): void {
  fetchImpl = next ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>)
}

function progress(event: SpeechDownloadProgress): void {
  sendToAppWindows('speech:download-progress', event)
}

export function startModelDownload(id: string): { success: boolean; error?: string } {
  const model = speechModel(id)
  if (!model) return { success: false, error: 'Unknown model.' }
  if (downloads.has(id)) return { success: true }
  const controller = new AbortController()
  const entry = { controller, progress: partialBytes(speechModelsDir(), model) }
  downloads.set(id, entry)
  downloadErrors.delete(id)
  let lastSent = 0
  void downloadModel(speechModelsDir(), model, fetchImpl, ({ downloadedBytes, totalBytes }) => {
    entry.progress = downloadedBytes
    const now = Date.now()
    if (now - lastSent > 250 || downloadedBytes === totalBytes) {
      lastSent = now
      progress({ id, downloadedBytes, totalBytes, done: false })
    }
  }, controller.signal)
    .then(async () => {
      downloads.delete(id)
      // The first model downloaded becomes the one local speech uses.
      if (!getAiSettings().speech.modelId || !activeModel()) await patchAiSettings({ speech: { ...getAiSettings().speech, modelId: id } })
      progress({ id, downloadedBytes: model.size, totalBytes: model.size, done: true })
    })
    .catch((err: unknown) => {
      downloads.delete(id)
      const cancelled = controller.signal.aborted
      const message = cancelled ? 'Paused.' : err instanceof Error ? err.message : 'The download failed.'
      if (!cancelled) downloadErrors.set(id, message)
      progress({ id, downloadedBytes: partialBytes(speechModelsDir(), model), totalBytes: model.size, done: false, error: message })
    })
  return { success: true }
}

export function cancelModelDownload(id: string): boolean {
  const running = downloads.get(id)
  if (!running) return false
  running.controller.abort()
  return true
}

export async function deleteSpeechModel(id: string): Promise<boolean> {
  const model = speechModel(id)
  if (!model) return false
  cancelModelDownload(id)
  await getEngine()?.unloadModel(modelFilePath(speechModelsDir(), model))
  deleteModelFiles(speechModelsDir(), model)
  downloadErrors.delete(id)
  if (getAiSettings().speech.modelId === id) await patchAiSettings({ speech: { ...getAiSettings().speech, modelId: null } })
  return true
}

// --- Recording sessions -------------------------------------------------------------------

interface ActiveSession {
  id: number
  sender: WebContents
  session: SpeechSession
}

let nextSessionId = 1
let active: ActiveSession | null = null

function send(sessionId: number, sender: WebContents, event: SpeechEvent): void {
  if (sender.isDestroyed()) return
  sender.send('speech:event', { sessionId, event })
}

export async function startSpeechSession(
  sender: WebContents,
  options: SpeechStartOptions,
): Promise<{ success: true; sessionId: number } | { success: false; error: string; code: 'unavailable' | 'mic-denied' | 'busy' }> {
  const speech = getEngine()
  const model = activeModel()
  if (!speech || !model) return { success: false, code: 'unavailable', error: 'Local speech needs a downloaded speech model (Settings, Assistant).' }
  if (active && active.sender !== sender && !active.sender.isDestroyed() && !active.session.finished) {
    return { success: false, code: 'busy', error: 'Speech is in use in another window.' }
  }
  active?.session.cancel()
  active = null
  if (await ensureMicrophone()) return { success: false, code: 'mic-denied', error: MIC_DENIED_REASON }

  const id = nextSessionId++
  const language = typeof options.language === 'string' && /^(auto|[a-z]{2})$/.test(options.language) ? options.language : getAiSettings().speech.language
  const hint = typeof options.hint === 'string' && options.hint.trim() ? options.hint.slice(0, SPEECH.hint.max_chars) : null
  const session = new SpeechSession(speech, {
    modelPath: modelFilePath(speechModelsDir(), model),
    engine: model.engine === 'parakeet' ? VS_ENGINE_PARAKEET : VS_ENGINE_WHISPER,
    language,
    hint,
  }, (event) => {
    send(id, sender, event)
    if ((event.type === 'final' || event.type === 'error') && active?.id === id) active = null
  })
  active = { id, sender, session }
  sender.once('destroyed', () => {
    if (active?.id === id) {
      session.cancel()
      active = null
    }
  })
  try {
    session.start()
  } catch (err) {
    active = null
    return { success: false, code: 'unavailable', error: err instanceof Error ? err.message : 'Speech could not start.' }
  }
  return { success: true, sessionId: id }
}

function sessionFor(sender: WebContents, id: unknown): ActiveSession | null {
  return active && active.sender === sender && active.id === id ? active : null
}

export function feedSpeechAudio(sender: WebContents, id: unknown, samples: unknown): boolean {
  const current = sessionFor(sender, id)
  if (!current) return false
  const audio = samples instanceof Float32Array ? samples : ArrayBuffer.isView(samples) ? new Float32Array((samples as ArrayBufferView).buffer.slice(0)) : null
  if (!audio) return false
  current.session.addAudio(audio)
  return true
}

export function stopSpeechSession(sender: WebContents, id: unknown): boolean {
  const current = sessionFor(sender, id)
  if (!current) return false
  void current.session.stop()
  return true
}

export function cancelSpeechSession(sender: WebContents, id: unknown): boolean {
  const current = sessionFor(sender, id)
  if (!current) return false
  current.session.cancel()
  active = null
  return true
}

/** Before quit: every native handle closed, downloads stopped (their partial files stay). */
export async function shutdownSpeech(): Promise<void> {
  active?.session.cancel()
  active = null
  for (const running of downloads.values()) running.controller.abort()
  if (engine) await engine.closeAll()
}
