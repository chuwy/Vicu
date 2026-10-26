import { createServer, type Server } from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeTransport, readText, redactHeaders, TransportError } from '../ai/transport'

// docs/ai-assistant-v1.md section 2.5: the idle limit counts from the request until data arrives
// and between chunks; keys never show in a log line.
let server: Server | null = null
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler)
  return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => {
    const address = server!.address()
    resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
  }))
}

describe('AI transport', () => {
  it('streams the answer', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: a\n\n')
      setTimeout(() => res.end('data: b\n\n'), 20)
    })
    const response = await nodeTransport({ url, method: 'POST', headers: { authorization: 'Bearer secret' }, body: '{}', connectTimeoutMs: 1000, idleTimeoutMs: 1000 })
    expect(response.status).toBe(200)
    expect(await readText(response.body)).toBe('data: a\n\ndata: b\n\n')
  })

  it('times out when no data arrives for the idle limit', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: a\n\n')
      // ...and then nothing.
    })
    const response = await nodeTransport({ url, method: 'POST', headers: {}, body: '{}', connectTimeoutMs: 1000, idleTimeoutMs: 150 })
    await expect(readText(response.body)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('times out waiting for the first byte (a slow model) as a timeout', async () => {
    const url = await listen(() => { /* never answers */ })
    await expect(nodeTransport({ url, method: 'POST', headers: {}, body: '{}', connectTimeoutMs: 1000, idleTimeoutMs: 150 }))
      .rejects.toBeInstanceOf(TransportError)
  })

  it('is cancelled by its signal', async () => {
    const url = await listen(() => { /* never answers */ })
    const controller = new AbortController()
    const pending = nodeTransport({ url, method: 'POST', headers: {}, body: '{}', connectTimeoutMs: 1000, idleTimeoutMs: 5000, signal: controller.signal })
    setTimeout(() => controller.abort(), 30)
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('redacts the key headers', () => {
    expect(redactHeaders({ Authorization: 'Bearer s', 'x-api-key': 'k', 'X-Goog-Api-Key': 'g', 'anthropic-version': '2023-06-01' })).toEqual({
      Authorization: '[redacted]', 'x-api-key': '[redacted]', 'X-Goog-Api-Key': '[redacted]', 'anthropic-version': '2023-06-01',
    })
  })
})
