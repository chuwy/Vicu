import { loadConfig, saveConfig, saveConfigQuietly, withoutOtherUsersData } from './config'
import { normalizeServerUrl } from './offline/owner'

/**
 * The signed-in user's id. The offline queue uses it to tell two users of one server apart, and the
 * hidden tasks depend on it: an app reads, merges, writes and deletes only its own user's carriers
 * (docs/cross-app-semantics-v1.md section 10.3), and discovers none until it knows who it is.
 *
 * It is learnt from `GET user` (at sign-in, and once for a session that started before this was
 * kept) and stored in config.json (`known_user`, account specific), so an offline start still knows
 * it. Signing out or in forgets it.
 */

interface KnownUser {
  server: string
  id: number
}

// undefined: not read from config.json yet; null: nobody known.
let cached: KnownUser | null | undefined

function readStored(): KnownUser | null {
  const stored = loadConfig()?.known_user
  return stored && typeof stored.server === 'string' && Number.isInteger(stored.id) && stored.id > 0
    ? { server: stored.server, id: stored.id }
    : null
}

function current(): KnownUser | null {
  if (cached === undefined) cached = readStored()
  return cached
}

function store(user: KnownUser | null): void {
  const config = loadConfig()
  if (!config) return
  const stored = config.known_user
  if (user === null ? stored === undefined : stored?.server === user.server && stored.id === user.id) return
  config.known_user = user ?? undefined
  saveConfigQuietly(config, 'the signed-in user')
}

const accountDataClearedListeners = new Set<() => void>()

/** Called after another user's data was cleared (the services tell the windows). */
export function onAccountDataCleared(listener: () => void): () => void {
  accountDataClearedListeners.add(listener)
  return () => { accountDataClearedListeners.delete(listener) }
}

/**
 * The account data in config.json belongs to this user from now on. When it belonged to someone
 * else (another user of the same server signed in, possibly after signing out), that user's custom
 * lists, synced settings and Inbox are cleared first, so they are neither shown nor merged into the
 * new user's carriers. A config without an owner (older versions did not record one) is adopted as
 * it is. Returns true when data was cleared.
 */
export function claimAccountData(serverUrl: string, userId: number): boolean {
  if (!Number.isInteger(userId) || userId <= 0) return false
  const config = loadConfig()
  if (!config || config.standalone_mode) return false
  const server = normalizeServerUrl(serverUrl)
  const owner = config.account_owner
  if (owner?.server === server && owner.id === userId) return false
  const cleared = owner !== undefined
  const next = cleared ? withoutOtherUsersData(config) : config
  next.account_owner = { server, id: userId }
  if (cleared) {
    saveConfig(next)
    console.log('[Account] Another user signed in; the previous user\'s lists and synced settings were cleared')
    for (const listener of accountDataClearedListeners) listener()
  } else {
    saveConfigQuietly(next, 'the account owner')
  }
  return cleared
}

/** The user id of the signed-in account, as the server answered it. */
export function rememberKnownUser(serverUrl: string, userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) return
  claimAccountData(serverUrl, userId)
  cached = { server: normalizeServerUrl(serverUrl), id: userId }
  store(cached)
}

/** Signing out or in changes who the account is; the id is looked up again for the next one. */
export function forgetKnownUser(): void {
  cached = null
  store(null)
}

export function knownUserIdFor(serverUrl: string): number | undefined {
  const user = current()
  return user && user.server === normalizeServerUrl(serverUrl) ? user.id : undefined
}

/** Asks the server who the signed-in user is (set by sync.ts, which owns the throttled lookup). */
let lookup: (() => Promise<void>) | null = null

export function setKnownUserLookup(run: () => Promise<void>): void {
  lookup = run
}

/**
 * The signed-in user's id for the configured server, asking the server once when it is not known
 * yet. Undefined in standalone mode, signed out, offline before the first lookup, or while a failed
 * lookup waits to be retried.
 */
export async function ensureKnownUserId(): Promise<number | undefined> {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return undefined
  const known = knownUserIdFor(config.vikunja_url)
  if (known !== undefined || !lookup) return known
  try {
    await lookup()
  } catch {
    // Best effort; the next caller asks again (the lookup throttles itself).
  }
  return knownUserIdFor(config.vikunja_url)
}

/** For tests: forget what was read from config.json. */
export function resetKnownUserCache(): void {
  cached = undefined
  accountDataClearedListeners.clear()
}
