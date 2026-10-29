import { useState } from 'react'
import { Button } from '@/components/shared/Button'
import { BROWSER_SIGN_IN_REDIRECT_URI } from '../../../shared/oidc-browser'

interface BrowserSignInProps {
  /** Unknown while signing in again before the server answered. */
  providerName?: string
  /** The sign-in window met a passkey prompt: say why the browser is needed. */
  passkeyPrompted: boolean
  waiting: boolean
  error: string
  onStart: () => void
  onCancel: () => void
}

/**
 * OIDC sign-in in the system browser (src/shared/oidc-browser.ts), for providers that sign in with
 * a passkey. The browser comes back to Vicu on a loopback address, which the provider has to know:
 * the panel shows it with a Copy button, then starts the sign-in and waits for it.
 */
export function BrowserSignIn({ providerName, passkeyPrompted, waiting, error, onStart, onCancel }: BrowserSignInProps) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(BROWSER_SIGN_IN_REDIRECT_URI).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      {passkeyPrompted && (
        <p className="text-sm text-text">
          {providerName ?? 'The sign-in page'} asked for a passkey. Passkeys can't be used in Vicu's sign-in window, so sign in through your browser instead.
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs text-text-secondary">
          Your browser returns to Vicu at the address below. Add it once as a redirect URL (callback URL) of the Vikunja client in {providerName ?? 'your identity provider'}:
        </p>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 select-all break-all rounded-control border border-border bg-bg-page px-2 py-1.5 font-mono text-xs text-text"
            title={BROWSER_SIGN_IN_REDIRECT_URI}
            data-testid="browser-sign-in-redirect"
          >
            {BROWSER_SIGN_IN_REDIRECT_URI}
          </code>
          <Button variant="secondary" onClick={copy} aria-label="Copy the redirect URL">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {waiting ? (
        <>
          <p className="text-xs text-text-secondary" role="status">
            Finish signing in in your browser. Vicu continues once you're done.
          </p>
          <Button variant="secondary" onClick={onCancel} className="w-full">
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={onStart} className="w-full">
          Continue in browser
        </Button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </>
  )
}
