import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The signed-in user's id decides which hidden tasks are the app's own (cross-app semantics 10.3).
// It is kept in config.json so an offline start still knows it.

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
}))

async function load() {
  vi.resetModules()
  return await import('../known-user')
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({ vikunja_url: 'https://tasks.example.com', api_token: 'x', ...extra }), 'utf-8')
}

const saved = () => JSON.parse(readFileSync(join(state.dir, 'config.json'), 'utf-8')) as { known_user?: unknown }

describe('known user', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-known-user-'))
  })
  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('is stored in config.json and read back after a restart', async () => {
    writeConfig()
    const first = await load()
    first.rememberKnownUser('https://tasks.example.com/', 12)
    expect(saved().known_user).toEqual({ server: 'https://tasks.example.com', id: 12 })

    const second = await load()
    expect(second.knownUserIdFor('https://tasks.example.com')).toBe(12)
    expect(second.knownUserIdFor('https://other.example.com')).toBeUndefined()
  })

  it('is forgotten when the account changes', async () => {
    writeConfig({ known_user: { server: 'https://tasks.example.com', id: 12 } })
    const known = await load()
    known.forgetKnownUser()
    expect(saved().known_user).toBeUndefined()
    expect(known.knownUserIdFor('https://tasks.example.com')).toBeUndefined()
  })

  it('asks the server once when it is not known, and answers undefined when that fails', async () => {
    writeConfig()
    const known = await load()
    expect(await known.ensureKnownUserId()).toBeUndefined()
    const lookup = vi.fn(async () => known.rememberKnownUser('https://tasks.example.com', 4))
    known.setKnownUserLookup(lookup)
    expect(await known.ensureKnownUserId()).toBe(4)
    expect(await known.ensureKnownUserId()).toBe(4)
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
