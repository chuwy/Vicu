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

  describe('account data of another user (a different user of the same server signs in)', () => {
    const accountData = {
      inbox_project_id: 5,
      custom_lists: [{ id: 'a' }],
      custom_lists_sync: { dirty: true },
      synced_prefs_sync: { moved: true },
      sidebar_collapsed_projects: [3],
      last_username: 'bea',
      theme: 'dark',
    }
    const savedFull = () => JSON.parse(readFileSync(join(state.dir, 'config.json'), 'utf-8')) as Record<string, unknown>

    it('clears the previous user\'s lists, synced settings and Inbox, and keeps device preferences', async () => {
      writeConfig({ ...accountData, account_owner: { server: 'https://tasks.example.com', id: 12 } })
      const known = await load()
      const cleared = vi.fn()
      known.onAccountDataCleared(cleared)
      known.rememberKnownUser('https://tasks.example.com', 13)
      const config = savedFull()
      expect(cleared).toHaveBeenCalledOnce()
      expect(config.inbox_project_id).toBe(0)
      expect(config.custom_lists_sync).toBeUndefined()
      expect(config.synced_prefs_sync).toBeUndefined()
      expect(config.sidebar_collapsed_projects).toBeUndefined()
      expect(config.account_owner).toEqual({ server: 'https://tasks.example.com', id: 13 })
      expect(config.known_user).toEqual({ server: 'https://tasks.example.com', id: 13 })
      expect(config.theme).toBe('dark')
      expect(config.last_username).toBe('bea')
    })

    it('keeps everything for the same user, also after signing out and in again', async () => {
      writeConfig({ ...accountData, account_owner: { server: 'https://tasks.example.com', id: 12 } })
      const known = await load()
      known.forgetKnownUser()
      known.rememberKnownUser('https://tasks.example.com', 12)
      const config = savedFull()
      expect(config.inbox_project_id).toBe(5)
      expect(config.custom_lists_sync).toEqual({ dirty: true })
    })

    it('adopts the data of a config from a version that recorded no owner', async () => {
      writeConfig(accountData)
      const known = await load()
      expect(known.claimAccountData('https://tasks.example.com', 12)).toBe(false)
      const config = savedFull()
      expect(config.inbox_project_id).toBe(5)
      expect(config.account_owner).toEqual({ server: 'https://tasks.example.com', id: 12 })
    })
  })
})
