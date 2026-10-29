import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An API token without a route group is answered 401, like an ended session; a token that still
// reads the project list was refused only that request (cross-app semantics 9.7).

interface FakeRequest extends EventEmitter {
  method: string
  url: string
  headers: Record<string, string>
  respond(status: number, headers?: Record<string, string>): FakeResponse
}
type FakeResponse = EventEmitter & { statusCode: number; headers: Record<string, string> }

const net = vi.hoisted(() => ({
  requests: [] as unknown[],
  onRequest: null as null | ((req: unknown) => void),
}))
const auth = vi.hoisted(() => ({ method: 'api_token' as string }))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class Req extends Emitter {
    headers: Record<string, string> = {}
    constructor(public method: string, public url: string) {
      super()
    }
    setHeader(name: string, value: string): void {
      this.headers[name] = value
    }
    write(): void {}
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
  loadConfig: () => ({ vikunja_url: 'https://tasks.example.com', auth_method: auth.method, api_token: 'tk' }),
}))
vi.mock('../auth/auth-manager', () => ({
  authManager: {
    getTokenSync: () => 'jwt',
    getToken: async () => {
      if (auth.method === 'api_token') throw new Error('No session')
      return 'jwt'
    },
  },
}))
vi.mock('../auth/token-store', () => ({ getAPIToken: () => 'tk' }))

async function loadClient() {
  vi.resetModules()
  net.requests.length = 0
  net.onRequest = null
  return await import('../api-client')
}

function sent(): FakeRequest[] {
  return net.requests as FakeRequest[]
}

function answerJson(req: FakeRequest, status: number, payload: unknown): void {
  const res = req.respond(status, { 'content-type': 'application/json' })
  res.emit('data', Buffer.from(JSON.stringify(payload)))
  res.emit('end')
}

const NO_ROUTE = { message: 'missing, malformed, expired or otherwise invalid token provided', code: 11 }

/** The project list answers `projects`; every other request is refused with 401. */
function serve(projects: (req: FakeRequest) => void): void {
  net.onRequest = (req) => {
    queueMicrotask(() => {
      const r = req as FakeRequest
      if (new URL(r.url).pathname === '/api/v2/projects') projects(r)
      else answerJson(r, 401, NO_ROUTE)
    })
  }
}

const projectChecks = () => sent().filter((r) => new URL(r.url).pathname === '/api/v2/projects')

describe('a 401 from a collaboration endpoint', () => {
  beforeEach(() => {
    auth.method = 'api_token'
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a refused request when the token still reads the projects', async () => {
    const client = await loadClient()
    serve((req) => answerJson(req, 200, []))

    const result = await client.createTaskComment(5, '<p>hi</p>')

    expect(result).toMatchObject({ success: false, statusCode: 403, tokenPermission: true })
    if (!result.success) expect(result.error).toContain('API token does not have this permission')
    const check = projectChecks()
    expect(check).toHaveLength(1)
    expect(new URL(check[0].url).searchParams.get('per_page')).toBe('1')
    expect(check[0].headers.Authorization).toBe('Bearer tk')
    // Vikunja lists a session under its User-Agent; this mock of electron has no app version.
    for (const req of sent()) expect(req.headers['User-Agent']).toMatch(/^Vicu \(/)
  })

  it('says that a token cannot follow a task', async () => {
    const client = await loadClient()
    serve((req) => answerJson(req, 200, []))

    const result = await client.subscribeToTask(5)

    expect(result).toMatchObject({ success: false, statusCode: 403, tokenPermission: true })
    if (!result.success) expect(result.error).toContain('does not let API tokens follow tasks')
  })

  it('checks the token once for refusals close together', async () => {
    const client = await loadClient()
    serve((req) => answerJson(req, 200, []))

    await client.fetchProjectUserShares(3)
    await client.fetchProjectUserShares(4)
    await client.addTaskAssignee(5, 2)

    expect(projectChecks()).toHaveLength(1)
  })

  it('stays a 401 when the token is refused the projects too', async () => {
    const client = await loadClient()
    serve((req) => answerJson(req, 401, NO_ROUTE))

    const result = await client.createTaskComment(5, '<p>hi</p>')

    expect(result).toMatchObject({ success: false, statusCode: 401 })
    expect(result).not.toHaveProperty('tokenPermission')
  })

  it('is not checked for a password or OIDC session, whose token has every permission', async () => {
    auth.method = 'password'
    const client = await loadClient()
    serve((req) => answerJson(req, 200, []))

    const result = await client.createTaskComment(5, '<p>hi</p>')

    expect(result).toMatchObject({ success: false, statusCode: 401 })
    expect(projectChecks()).toHaveLength(0)
  })

  it('keeps the project message for a 403', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answerJson(req as FakeRequest, 403, { message: 'Forbidden', code: 1 }))

    const result = await client.createTaskComment(5, '<p>hi</p>')

    expect(result).toMatchObject({ success: false, statusCode: 403 })
    expect(result).not.toHaveProperty('tokenPermission')
    if (!result.success) expect(result.error).toBe('You can only read this project, so this was not changed.')
  })
})
