import type { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// The routine carrier writes are JSON Patches with a test of the description read (cross-app
// semantics 6.8): a 422 is passed on with its status, and a 304 reads the task back.

interface FakeRequest extends EventEmitter {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  respond(status: number, headers?: Record<string, string>): FakeResponse
}
type FakeResponse = EventEmitter & { statusCode: number; headers: Record<string, string> }

const net = vi.hoisted(() => ({
  requests: [] as unknown[],
  onRequest: null as null | ((req: unknown) => void),
}))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class Req extends Emitter {
    headers: Record<string, string> = {}
    body = ''
    constructor(public method: string, public url: string) {
      super()
    }
    setHeader(name: string, value: string): void {
      this.headers[name] = value
    }
    write(chunk: string): void {
      this.body += chunk
    }
    end(): void {
      net.onRequest?.(this)
    }
    abort(): void {}
    respond(status: number, headers: Record<string, string> = {}): FakeResponse {
      const res = new Emitter() as FakeResponse
      res.statusCode = status
      res.headers = headers
      this.emit('response', res)
      return res
    }
  }
  return {
    net: {
      request: (options: { method: string; url: string }) => {
        const req = new Req(options.method, options.url)
        net.requests.push(req)
        return req
      },
    },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

vi.mock('../config', () => ({
  loadConfig: () => ({ vikunja_url: 'https://tasks.example.com', auth_method: 'password' }),
}))
vi.mock('../auth/auth-manager', () => ({
  authManager: { getTokenSync: () => 'jwt', getToken: async () => 'jwt' },
}))
vi.mock('../auth/token-store', () => ({ getAPIToken: () => null }))

async function loadClient() {
  vi.resetModules()
  net.requests.length = 0
  net.onRequest = null
  return await import('../api-client')
}

function answer(req: FakeRequest, status: number, payload?: unknown): void {
  const res = req.respond(status, { 'content-type': 'application/json' })
  if (payload !== undefined) res.emit('data', Buffer.from(JSON.stringify(payload)))
  res.emit('end')
}

const OPS = [
  { op: 'test', path: '/description', value: 'old' },
  { op: 'replace', path: '/description', value: 'new' },
]

describe('patchTaskJson', () => {
  it('sends the operations as application/json-patch+json', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 200, { id: 5, description: 'new' }))
    const result = await client.patchTaskJson(5, OPS)
    expect(result).toEqual({ success: true, data: { id: 5, description: 'new' } })
    const [req] = net.requests as FakeRequest[]
    expect(req.method).toBe('PATCH')
    expect(new URL(req.url).pathname).toBe('/api/v2/tasks/5')
    expect(req.headers['Content-Type']).toBe('application/json-patch+json')
    expect(JSON.parse(req.body)).toEqual(OPS)
  })

  it('passes a failed test (422) on with its status', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 422, { title: 'Unprocessable Entity', detail: 'Unable to apply patch' }))
    const result = await client.patchTaskJson(5, OPS)
    expect(result).toMatchObject({ success: false, statusCode: 422 })
  })

  it('reads the task back after a 304 (nothing changed)', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => {
      const r = req as FakeRequest
      if (r.method === 'PATCH') answer(r, 304)
      else answer(r, 200, { id: 5, description: 'same' })
    })
    const result = await client.patchTaskJson(5, OPS)
    expect(result).toEqual({ success: true, data: { id: 5, description: 'same' } })
    expect((net.requests as FakeRequest[]).map((r) => r.method)).toEqual(['PATCH', 'GET'])
  })
})
