/**
 * Signing in through the system browser (RFC 8252, loopback redirect).
 *
 * The sign-in window cannot use passkeys on macOS and Linux (Electron only serves platform
 * authenticators it was configured for, and has no UI for security keys), so an identity provider
 * that signs in with a passkey (Pocket ID, or any provider where the user chose one) cannot be
 * completed there. In the browser the user's own passkeys work. The browser cannot hand the code to
 * Vikunja's frontend callback without Vikunja's web app spending it, so this flow redirects to a
 * listener Vicu runs on the loopback interface, and that address has to be added to the client at
 * the identity provider once.
 *
 * The port is fixed so the one address works with providers that only match redirect URIs exactly;
 * providers that follow RFC 8252 section 7.3 accept it with any port as well.
 */
export const BROWSER_SIGN_IN_PORT = 47823
export const BROWSER_SIGN_IN_PATH = '/vicu/oidc-callback'
export const BROWSER_SIGN_IN_REDIRECT_URI = `http://127.0.0.1:${BROWSER_SIGN_IN_PORT}${BROWSER_SIGN_IN_PATH}`

/** How the user signed in with OIDC last time, so signing in again starts the same way. */
export type OidcSignInMode = 'window' | 'browser'
