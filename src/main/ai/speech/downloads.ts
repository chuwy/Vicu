/**
 * Speech model files (docs/ai-assistant-v1.md section 3.5): downloaded from
 * `https://huggingface.co/<repo>/resolve/<commit>/<file>`, resumed with HTTP `Range` from the
 * partial file, checked against the fixture's SHA-256 before use (a file that fails is deleted),
 * stored in the user data folder and deleted from Settings. Free of Electron: the folder and fetch
 * are passed in, so tests run it against a fake server.
 */
import { createHash } from 'crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { open } from 'fs/promises'
import { join } from 'path'
import { speechModelUrl, type SpeechModelInfo } from '../../../shared/ai/contract'

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null
}>

export interface DownloadProgress {
  downloadedBytes: number
  totalBytes: number
}

export function modelFilePath(dir: string, model: Pick<SpeechModelInfo, 'file'>): string {
  return join(dir, model.file)
}

export function partialFilePath(dir: string, model: Pick<SpeechModelInfo, 'file'>): string {
  return join(dir, `${model.file}.part`)
}

/** A finished download: the file is there with the fixture's size (its hash was checked when it landed). */
export function isDownloaded(dir: string, model: Pick<SpeechModelInfo, 'file' | 'size'>): boolean {
  const path = modelFilePath(dir, model)
  try {
    return statSync(path).size === model.size
  } catch {
    return false
  }
}

export function partialBytes(dir: string, model: Pick<SpeechModelInfo, 'file'>): number {
  try {
    return statSync(partialFilePath(dir, model)).size
  } catch {
    return 0
  }
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function* chunksOf(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in body) {
    yield* body as AsyncIterable<Uint8Array>
    return
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

export class DownloadError extends Error {}

/**
 * Downloads a model into `dir`, resuming a partial file. Resolves once the file is in place and
 * its SHA-256 matched; a mismatch deletes it and throws. A cancelled download keeps its partial
 * file for the next try.
 */
export async function downloadModel(
  dir: string,
  model: SpeechModelInfo,
  fetchImpl: FetchLike,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const finalPath = modelFilePath(dir, model)
  const partPath = partialFilePath(dir, model)
  if (isDownloaded(dir, model)) return

  let have = partialBytes(dir, model)
  if (have > model.size) {
    unlinkSync(partPath)
    have = 0
  }
  if (have < model.size) {
    const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-` } : {}
    const response = await fetchImpl(speechModelUrl(model), { headers, signal })
    if (response.status === 416 && have > 0) {
      // The server has nothing after what we have: the partial file is whole, the hash decides.
    } else if (!response.ok || !response.body) {
      throw new DownloadError(`The download failed (HTTP ${response.status}).`)
    } else {
      // 206: the rest follows; 200: the server ignored the range, so start again.
      const append = response.status === 206 && have > 0
      if (!append) have = 0
      const file = await open(partPath, append ? 'a' : 'w')
      try {
        onProgress({ downloadedBytes: have, totalBytes: model.size })
        for await (const chunk of chunksOf(response.body)) {
          await file.write(chunk)
          have += chunk.byteLength
          onProgress({ downloadedBytes: have, totalBytes: model.size })
          if (have > model.size) throw new DownloadError('The file is larger than expected.')
        }
      } finally {
        await file.close()
      }
    }
  }

  const digest = await sha256OfFile(partPath)
  if (digest !== model.sha256) {
    try {
      unlinkSync(partPath)
    } catch {
      // gone already
    }
    throw new DownloadError('The downloaded file did not match its checksum and was deleted. Try again.')
  }
  renameSync(partPath, finalPath)
  onProgress({ downloadedBytes: model.size, totalBytes: model.size })
}

export function deleteModelFiles(dir: string, model: Pick<SpeechModelInfo, 'file'>): void {
  for (const path of [modelFilePath(dir, model), partialFilePath(dir, model)]) {
    if (existsSync(path)) unlinkSync(path)
  }
}
