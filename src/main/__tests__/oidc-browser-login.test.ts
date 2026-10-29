import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({
  dir: '',
  fetch: undefined as unknown as Mock<(...args: any[]) => any>,
  /** What the browser does with the authorization URL Vicu opens. */
  browser: undefined as unknown as (authUrl: URL) => Promise<void>,
  opened: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir, focus: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
  net: { fetch: (...args: unknown[]) => state.fetch(...args) },
  shell: {
    openExternal: async (url: string) => {
      state.opened.push(url)
      void state.browser(new URL(url))
    },
  },
  BrowserWindow: class {},
  screen: {},
}))

vi.mock('../quick-entry-state', () => ({ getMainWindow: () => null }))

// Any free port: the fixed one could be taken on the machine running the tests.
vi.mock('../../shared/oidc-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/oidc-browser')>()),
  BROWSER_SIGN_IN_PORT: 0,
}))

const BASE = 'https://tasks.example.com'
const PROVIDER = {
  name: 'Pocket ID',
  key: 'pocketid',
  auth_url: 'https://id.example.com/authorize',
  client_id: 'vikunja-client',
  scope: 'openid profile email',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Exchange {
  body: Record<string, string>
}

function installVikunja(exchangeStatus = 200): Exchange[] {
  const exchanges: Exchange[] = []
  state.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === `${BASE}/api/v2/info`) {
      return json({ auth: { openid_connect: { enabled: true, providers: [PROVIDER] } } })
    }
    if (method === 'POST' && url === `${BASE}/api/v2/auth/openid/pocketid/callback`) {
      exchanges.push({ body: JSON.parse(String(init?.body)) })
      if (exchangeStatus === 412) return json({ code: 1017, message: 'Two-factor authentication is required' }, 412)
      return json({ token: 'header.eyJleHAiOjQxMDI0NDQ4MDB9.sig' })
    }
    if (url === `${BASE}/api/v2/routes`) return json({ tasks: { read_all: {} } })
    if (method === 'POST' && url === `${BASE}/api/v2/tokens`) return json({ id: 7, token: 'tk_7' }, 201)
    if (url.startsWith(`${BASE}/api/v2/tokens?`)) return json({ items: [], total_pages: 1 })
    throw new Error(`unexpected request ${method} ${url}`)
  })
  return exchanges
}

/** A browser where the user signs in: the provider redirects back with a code and the state. */
function signsIn(code = 'the-code') {
  return async (authUrl: URL) => {
    const redirect = new URL(authUrl.searchParams.get('redirect_uri')!)
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', authUrl.searchParams.get('state')!)
    await fetch(redirect)
  }
}

beforeEach(() => {
  vi.resetModules()
  state.dir = mkdtempSync(join(tmpdir(), 'vicu-browser-login-'))
  state.opened = []
})

afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true })
})

describe('loginWithOIDCInBrowser', () => {
  it('signs in through the browser with the loopback redirect and remembers that it did', async () => {
    const exchanges = installVikunja()
    state.browser = signsIn()
    const { loginWithOIDCInBrowser } = await import('../auth/oidc-browser-login')
    const tokens = await import('../auth/token-store')

    const jwt = await loginWithOIDCInBrowser(BASE, 'pocketid')

    expect(jwt).toBe('header.eyJleHAiOjQxMDI0NDQ4MDB9.sig')
    const authUrl = new URL(state.opened[0])
    expect(authUrl.origin + authUrl.pathname).toBe(PROVIDER.auth_url)
    const redirectUri = authUrl.searchParams.get('redirect_uri')!
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/vicu\/oidc-callback$/)
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email offline_access')
    // Vikunja exchanges the code with the redirect it was issued for.
    expect(exchanges).toEqual([{ body: { code: 'the-code', scope: PROVIDER.scope, redirect_url: redirectUri } }])
    // The sign-in request names Vicu, so Vikunja's Sessions list shows which app signed in.
    const exchange = state.fetch.mock.calls.find(([url]) => String(url).endsWith('/auth/openid/pocketid/callback'))!
    expect((exchange[1] as RequestInit).headers).toMatchObject({ 'User-Agent': expect.stringMatching(/^Vicu/) })
    expect(tokens.getOidcSignInMode()).toBe('browser')
    expect(tokens.getProviderKey()).toBe('pocketid')
    expect(tokens.getJWT()).toBe(jwt)
  })

  it('signs in again with the provider used last time when no key is given', async () => {
    installVikunja()
    state.browser = signsIn()
    const { loginWithOIDCInBrowser } = await import('../auth/oidc-browser-login')
    await loginWithOIDCInBrowser(BASE, 'pocketid')
    await loginWithOIDCInBrowser(BASE)
    expect(state.opened).toHaveLength(2)
    expect(new URL(state.opened[1]).searchParams.get('client_id')).toBe(PROVIDER.client_id)
  })

  it('reports a two-factor challenge so the caller can ask for the code', async () => {
    installVikunja(412)
    state.browser = signsIn()
    const { loginWithOIDCInBrowser } = await import('../auth/oidc-browser-login')
    const { OidcTotpRequiredError } = await import('../auth/oidc-login')
    await expect(loginWithOIDCInBrowser(BASE, 'pocketid')).rejects.toBeInstanceOf(OidcTotpRequiredError)
  })

  it('stops waiting when cancelled, and a new sign-in cancels the one before it', async () => {
    const exchanges = installVikunja()
    state.browser = async () => {}
    const { cancelBrowserLogin, loginWithOIDCInBrowser } = await import('../auth/oidc-browser-login')
    const { BrowserSignInCancelledError } = await import('../auth/loopback-callback')

    const first = loginWithOIDCInBrowser(BASE, 'pocketid')
    await vi.waitFor(() => expect(state.opened).toHaveLength(1))
    const second = loginWithOIDCInBrowser(BASE, 'pocketid')
    await expect(first).rejects.toBeInstanceOf(BrowserSignInCancelledError)

    await vi.waitFor(() => expect(state.opened).toHaveLength(2))
    cancelBrowserLogin()
    await expect(second).rejects.toBeInstanceOf(BrowserSignInCancelledError)
    expect(exchanges).toEqual([])
  })
})
