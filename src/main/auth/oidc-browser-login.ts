import { app, shell } from 'electron'
import { randomUUID } from 'crypto'
import { getMainWindow } from '../quick-entry-state'
import { isMac } from '../platform'
import { buildAuthorizationUrl } from './oidc-url'
import { exchangeCodeForSession, findProvider } from './oidc-login'
import { listenForCallback } from './loopback-callback'
import { BROWSER_SIGN_IN_PATH, BROWSER_SIGN_IN_PORT } from '../../shared/oidc-browser'

const BROWSER_LOGIN_TIMEOUT = 5 * 60 * 1000

let active: AbortController | null = null

/** Stops waiting for the browser; the pending sign-in rejects with BrowserSignInCancelledError. */
export function cancelBrowserLogin(): void {
  active?.abort()
  active = null
}

function bringVicuForward(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  if (isMac) app.focus({ steal: true })
  win.focus()
}

/**
 * OIDC sign-in in the system browser (src/shared/oidc-browser.ts): the user's passkeys and the
 * provider's existing session work there. The redirect comes back to a listener on 127.0.0.1, which
 * has to be registered as a redirect URI of the Vikunja client at the provider; Vikunja exchanges
 * the code with that same redirect URI. A second call cancels the first.
 *
 * @returns The JWT string from Vikunja
 */
export async function loginWithOIDCInBrowser(
  vikunjaUrl: string,
  providerKey?: string,
  totpPasscode?: string
): Promise<string> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')
  const provider = await findProvider(baseUrl, providerKey)

  cancelBrowserLogin()
  const controller = new AbortController()
  active = controller

  const state = randomUUID()
  const callback = await listenForCallback({
    port: BROWSER_SIGN_IN_PORT,
    path: BROWSER_SIGN_IN_PATH,
    expectedState: state,
    timeoutMs: BROWSER_LOGIN_TIMEOUT,
    signal: controller.signal,
  })
  try {
    // Same request as the sign-in window (no PKCE, offline_access added), with the loopback redirect.
    const authUrl = buildAuthorizationUrl(provider, callback.redirectUri, state)
    await shell.openExternal(authUrl)
    const code = await callback.code
    bringVicuForward()
    return await exchangeCodeForSession(baseUrl, provider, code, callback.redirectUri, 'browser', totpPasscode)
  } finally {
    callback.close()
    if (active === controller) active = null
  }
}
