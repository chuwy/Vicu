/**
 * Passkeys in the OIDC sign-in window, free of Electron so it can be tested.
 *
 * On macOS and Linux the sign-in window cannot complete a WebAuthn request: Electron serves no
 * platform authenticator until `app.configureWebAuthn` is set up with the app's own keychain group
 * (whose credentials are not the user's passkeys anyway), and it has no UI for a security key's
 * PIN. `navigator.credentials.get()` then never settles, so a provider that signs in with a passkey,
 * such as Pocket ID, shows a spinner forever, or an "unknown error" where the page's own checks
 * fail first. The guard below makes such a request fail at once and tells Vicu, which closes the
 * window and offers the browser sign-in (see src/shared/oidc-browser.ts). On Windows Electron hands
 * WebAuthn to Windows Hello, which works, so the window is left alone there.
 */

/** Logged by the guard in the sign-in window; main watches the window's console for it. */
export const PASSKEY_SIGNAL = 'vicu:passkey-unavailable'

export function passkeysWorkInSignInWindow(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

/**
 * Runs in the page (main world). Only modal passkey requests are refused: a conditional request
 * (passkey autofill on a password form) is passed on, since it only waits in the background.
 * The message mentions "timed out" because older Pocket ID versions only recognise that wording.
 * The methods are replaced on the container's prototype, not on `navigator.credentials` itself: a
 * browser may hand out a new wrapper for the container later (WebKit does after garbage
 * collection), which would not have them. Same rule as the mobile app's OidcSignIn.kt.
 */
export const PASSKEY_GUARD_SCRIPT = `(() => {
  const marker = Symbol.for('vicu.passkeyGuard')
  if (window[marker]) return
  window[marker] = true
  const credentials = navigator.credentials
  if (!credentials) return
  const refuse = () => {
    console.info(${JSON.stringify(PASSKEY_SIGNAL)})
    return Promise.reject(new DOMException('The operation either timed out or was not allowed: passkeys cannot be used in this window.', 'NotAllowedError'))
  }
  const proto = Object.getPrototypeOf(credentials)
  const target = proto && proto !== Object.prototype ? proto : credentials
  const get = target.get
  const create = target.create
  target.get = function (options) { return options && options.publicKey && options.mediation !== 'conditional' ? refuse() : get.call(this, options) }
  target.create = function (options) { return options && options.publicKey ? refuse() : create.call(this, options) }
})()`
