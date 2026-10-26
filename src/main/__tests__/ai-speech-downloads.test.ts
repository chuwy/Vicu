import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadModel, isDownloaded, partialFilePath, type FetchLike } from '../ai/speech/downloads'
import type { SpeechModelInfo } from '../../shared/ai/contract'

// docs/ai-assistant-v1.md section 3.5: Hugging Face URL pinned to the commit, resume with Range,
// the SHA-256 checked before use, a file that fails the check deleted.
const content = Buffer.from('ggml model bytes '.repeat(1000))
const model: SpeechModelInfo = {
  id: 'test', engine: 'whisper', label: 'Test', repo: 'ggerganov/whisper.cpp', commit: 'abc123', file: 'ggml-test.bin',
  size: content.length, sha256: createHash('sha256').update(content).digest('hex'),
  language_count: 1, language_codes: null, license: 'MIT', attribution: null, default_for: [],
}

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vicu-speech-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function server(body: Buffer, options: { ignoreRange?: boolean; breakAfter?: number } = {}) {
  const calls: Array<{ url: string; range?: string }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, range: init.headers.Range })
    const match = /bytes=(\d+)-/.exec(init.headers.Range ?? '')
    const start = match && !options.ignoreRange ? Number(match[1]) : 0
    let slice = body.subarray(start)
    if (options.breakAfter !== undefined) slice = slice.subarray(0, options.breakAfter)
    const broken = options.breakAfter !== undefined
    return {
      status: start > 0 ? 206 : 200,
      ok: true,
      headers: { get: () => null },
      body: (async function* () {
        for (let i = 0; i < slice.length; i += 1000) yield slice.subarray(i, i + 1000)
        if (broken) throw new Error('connection reset')
      })(),
    }
  }
  return { fetchImpl, calls }
}

describe('speech model downloads', () => {
  it('downloads from the pinned URL, checks the hash and moves the file in place', async () => {
    const { fetchImpl, calls } = server(content)
    const progress: number[] = []
    await downloadModel(dir, model, fetchImpl, (p) => progress.push(p.downloadedBytes))
    expect(calls[0]).toEqual({ url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/abc123/ggml-test.bin', range: undefined })
    expect(isDownloaded(dir, model)).toBe(true)
    expect(readFileSync(join(dir, model.file))).toEqual(content)
    expect(progress.at(-1)).toBe(content.length)
    expect(existsSync(partialFilePath(dir, model))).toBe(false)
  })

  it('resumes a broken download with a Range request', async () => {
    const first = server(content, { breakAfter: 5000 })
    await expect(downloadModel(dir, model, first.fetchImpl, () => {})).rejects.toThrow('connection reset')
    expect(readFileSync(partialFilePath(dir, model)).length).toBe(5000)
    const second = server(content)
    await downloadModel(dir, model, second.fetchImpl, () => {})
    expect(second.calls[0].range).toBe('bytes=5000-')
    expect(readFileSync(join(dir, model.file))).toEqual(content)
  })

  it('starts again when the server ignores the range', async () => {
    writeFileSync(partialFilePath(dir, model), content.subarray(0, 3000))
    const { fetchImpl } = server(content, { ignoreRange: true })
    await downloadModel(dir, model, fetchImpl, () => {})
    expect(readFileSync(join(dir, model.file))).toEqual(content)
  })

  it('deletes a file that fails the SHA-256 check', async () => {
    const wrong = Buffer.from(content)
    wrong[10] = 0
    const { fetchImpl } = server(wrong)
    await expect(downloadModel(dir, model, fetchImpl, () => {})).rejects.toThrow(/checksum/)
    expect(existsSync(partialFilePath(dir, model))).toBe(false)
    expect(isDownloaded(dir, model)).toBe(false)
  })
})
