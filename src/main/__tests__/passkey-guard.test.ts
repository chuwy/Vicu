import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { PASSKEY_GUARD_SCRIPT, PASSKEY_SIGNAL, passkeysWorkInSignInWindow } from '../auth/passkey-guard'

/** A page with a credentials container whose own methods report what reached them. */
function page() {
  const reached: string[] = []
  const credentials = {
    get: (options: unknown) => {
      reached.push(`get ${JSON.stringify(options)}`)
      return Promise.resolve('original get')
    },
    create: (options: unknown) => {
      reached.push(`create ${JSON.stringify(options)}`)
      return Promise.resolve('original create')
    },
  }
  const info = vi.fn()
  // This realm's Object, so the guard sees the plain container's prototype as Object.prototype.
  const context: Record<string, unknown> = { navigator: { credentials }, console: { info }, DOMException, Promise, Symbol, Object }
  context.window = context
  runInNewContext(PASSKEY_GUARD_SCRIPT, context)
  return { credentials, info, reached, context }
}

describe('PASSKEY_GUARD_SCRIPT', () => {
  it('refuses a passkey request at once and signals Vicu', async () => {
    const { credentials, info, reached } = page()
    const error = await credentials.get({ publicKey: { challenge: 'x' } }).catch((e: DOMException) => e)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('NotAllowedError')
    // Older Pocket ID versions only recognise a message that says "timed out".
    expect((error as DOMException).message).toContain('timed out')
    expect(info).toHaveBeenCalledWith(PASSKEY_SIGNAL)
    expect(reached).toEqual([])

    await expect(credentials.create({ publicKey: { challenge: 'x' } })).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('passes on conditional (autofill) requests and requests that are not for a passkey', async () => {
    const { credentials, info, reached } = page()
    await expect(credentials.get({ publicKey: { challenge: 'x' }, mediation: 'conditional' })).resolves.toBe('original get')
    await expect(credentials.get({ password: true })).resolves.toBe('original get')
    await expect(credentials.create({ password: {} })).resolves.toBe('original create')
    expect(reached).toHaveLength(3)
    expect(info).not.toHaveBeenCalled()
  })

  it('wraps once when it runs again on the same page', async () => {
    const { credentials, info, context } = page()
    runInNewContext(PASSKEY_GUARD_SCRIPT, context)
    await credentials.get({ publicKey: {} }).catch(() => {})
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('still guards a new wrapper of the container (WebKit makes one after garbage collection)', async () => {
    const reached: string[] = []
    class CredentialsContainer {
      get(options: unknown) {
        reached.push(`get ${JSON.stringify(options)}`)
        return Promise.resolve(this instanceof CredentialsContainer ? 'original get' : 'wrong this')
      }
      create(options: unknown) {
        reached.push(`create ${JSON.stringify(options)}`)
        return Promise.resolve('original create')
      }
    }
    const info = vi.fn()
    const navigator = {}
    Object.defineProperty(navigator, 'credentials', { get: () => new CredentialsContainer() })
    const context: Record<string, unknown> = { navigator, console: { info }, DOMException, Promise, Symbol, Object }
    context.window = context
    runInNewContext(PASSKEY_GUARD_SCRIPT, context)

    const later = (navigator as { credentials: CredentialsContainer }).credentials
    await expect(later.get({ publicKey: { challenge: 'x' } })).rejects.toMatchObject({ name: 'NotAllowedError' })
    await expect(later.create({ publicKey: { challenge: 'x' } })).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(info).toHaveBeenCalledTimes(2)
    await expect(later.get({ publicKey: {}, mediation: 'conditional' })).resolves.toBe('original get')
    expect(reached).toEqual(['get {"publicKey":{},"mediation":"conditional"}'])
  })

  it('does nothing on a page without a credentials container', () => {
    const context: Record<string, unknown> = { navigator: {}, console, DOMException, Symbol }
    context.window = context
    expect(() => runInNewContext(PASSKEY_GUARD_SCRIPT, context)).not.toThrow()
  })
})

describe('passkeysWorkInSignInWindow', () => {
  it('is true only where Electron hands WebAuthn to the operating system', () => {
    expect(passkeysWorkInSignInWindow('win32')).toBe(true)
    expect(passkeysWorkInSignInWindow('darwin')).toBe(false)
    expect(passkeysWorkInSignInWindow('linux')).toBe(false)
  })
})
