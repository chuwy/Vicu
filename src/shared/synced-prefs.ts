/**
 * Synced preferences (docs/cross-app-semantics-v1.md section 11): the settings that change what a
 * list shows or how input is read, kept in one hidden carrier per account (`vicu-prefs:v1`). This
 * module holds the document rules (merge, pruning, reading a key, the one-time move); the main
 * process keeps the local copy and the carrier (`src/main/synced-preferences.ts`). Android has the
 * same rules; both run the `syncedPrefs` vectors of `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import {
  canonicalJson,
  compareRevisions,
  isSyncRevision,
  pruneTombstoneRecords,
  type SyncRevision,
} from './hidden-tasks'
import { DEFAULT_TASK_ORDER, GLOBAL_TASK_ORDER_KEY, parseTaskOrder, type TaskOrderKey } from './task-order'

export const SYNCED_PREFS_VERSION = 1

/** One setting. `value` is any JSON value; `null` means "the default". Unknown fields are kept. */
export interface SyncedPrefsEntry {
  value: unknown
  revision: SyncRevision
  [unknownField: string]: unknown
}

export interface SyncedPrefsDocument {
  version: number
  entries: Record<string, SyncedPrefsEntry>
  [unknownField: string]: unknown
}

/** What the windows get from the main process (`synced-prefs:get`, `synced-prefs-changed`). */
export interface SyncedPrefsSnapshot {
  /** Every entry's value by key (`null` for a reset). */
  values: Record<string, unknown>
  /** The Inbox in use (the local cache, `config.inbox_project_id`). */
  inboxProjectId: number
  /** Set once, when the first read of the carrier switched this device to the account's Inbox. */
  adoptedInbox?: number
}

export function emptySyncedPrefs(): SyncedPrefsDocument {
  return { version: SYNCED_PREFS_VERSION, entries: {} }
}

/**
 * `merge(local, server)`: the union of keys; for a key on both sides the newer revision wins and
 * equal revisions keep the server's entry (with its unknown fields). Unknown fields at the top level
 * are the union of both sides, the server's value kept for a field on both. No pruning here: the
 * caller prunes before writing and before comparing (section 10.6).
 */
export function mergeSyncedPrefs(local: SyncedPrefsDocument, server: SyncedPrefsDocument): SyncedPrefsDocument {
  const entries: Record<string, SyncedPrefsEntry> = {}
  for (const key of new Set([...Object.keys(local.entries), ...Object.keys(server.entries)])) {
    const mine = local.entries[key]
    const theirs = server.entries[key]
    entries[key] = !mine ? theirs : !theirs ? mine : compareRevisions(mine.revision, theirs.revision) > 0 ? mine : theirs
  }
  return { ...local, ...server, entries }
}

/** The document without tombstones older than 90 days before `now`. */
export function pruneSyncedPrefs(document: SyncedPrefsDocument, now: number): SyncedPrefsDocument {
  const entries = pruneTombstoneRecords(document.entries, now)
  return entries === document.entries ? document : { ...document, entries }
}

/** Same content, whatever the key order. */
export function sameSyncedPrefs(left: SyncedPrefsDocument, right: SyncedPrefsDocument): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

/** True when the document holds at least one entry (only then is a carrier created). */
export function hasSyncedPrefsEntries(document: SyncedPrefsDocument): boolean {
  return Object.keys(document.entries).length > 0
}

/**
 * Checks a decoded document. A version this app does not know is reported by the caller before it
 * gets here (it makes the kind read only); anything else that does not fit is malformed.
 */
export function validateSyncedPrefs(value: unknown): asserts value is SyncedPrefsDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferences metadata is invalid')
  const document = value as Partial<SyncedPrefsDocument>
  if (document.version !== SYNCED_PREFS_VERSION) throw new Error('Preferences payload version mismatch')
  if (!document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) {
    throw new Error('Preferences metadata structure is invalid')
  }
  for (const [key, entry] of Object.entries(document.entries)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Preference ${key} is invalid`)
    if (!isSyncRevision((entry as SyncedPrefsEntry).revision)) throw new Error(`Preference ${key} has an invalid revision`)
  }
}

/** The revision for a change made now on this device: newer than every revision in the document. */
export function nextSyncedPrefsRevision(document: SyncedPrefsDocument, deviceId: string, now: number): SyncRevision {
  const revisions = Object.values(document.entries).map((entry) => entry.revision)
  const maxWall = revisions.reduce((max, revision) => Math.max(max, revision.wall_time_ms), 0)
  const wallTime = Math.max(now, maxWall)
  const maxCounter = revisions
    .filter((revision) => revision.wall_time_ms === wallTime)
    .reduce((max, revision) => Math.max(max, revision.counter), -1)
  return {
    wall_time_ms: wallTime,
    counter: wallTime === now && now > maxWall ? 0 : maxCounter + 1,
    device_id: deviceId,
  }
}

/**
 * The document with `key` set to `value` (`null` resets it to the default on every device). The
 * entry's unknown fields stay.
 */
export function setSyncedPref(
  document: SyncedPrefsDocument,
  key: string,
  value: unknown,
  deviceId: string,
  now: number,
): SyncedPrefsDocument {
  const revision = nextSyncedPrefsRevision(document, deviceId, now)
  const previous = document.entries[key]
  return {
    ...document,
    entries: { ...document.entries, [key]: { ...(previous ?? {}), value: value === undefined ? null : value, revision } },
  }
}

/** The value of every entry by key (`null` for a reset). */
export function syncedPrefValues(document: SyncedPrefsDocument): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(document.entries)) values[key] = entry.value === undefined ? null : entry.value
  return values
}

// --- The registry (section 11.3) ------------------------------------------------------------

export const INBOX_PROJECT_ID_KEY = 'inbox_project_id'

/** The Inbox project id: a whole number above 0, or null (no entry, a reset, or a value that cannot be used). */
export function readInboxProjectId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** The global task order; anything that is not a known order reads as the default. */
export function readTaskOrderPref(value: unknown): TaskOrderKey {
  return parseTaskOrder(value)
}

/**
 * The value an app uses for `key`, given the entries' values (absent, `null`, an unknown value or a
 * wrong type read as the default). A per-project order reads as null when it has no entry, which
 * means "follow the parent" (see `resolveTaskOrder`). A key this version does not know is undefined.
 */
export function readSyncedPref(values: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = values[key]
  if (key === INBOX_PROJECT_ID_KEY) return readInboxProjectId(value)
  if (key === GLOBAL_TASK_ORDER_KEY) return readTaskOrderPref(value)
  if (/^task_order\.project\.\d+$/.test(key)) return value === undefined || value === null ? null : parseTaskOrder(value)
  return undefined
}

/**
 * The one-time move of a setting the device kept before it synced (section 11.5): after the first
 * successful read of the carrier, the local value is written as an entry only when it differs from
 * the default and the carrier has no entry for the key (a `null` entry counts as one). The Inbox has
 * no default, so any usable local Inbox moves.
 */
export function shouldMoveLocalPref(key: string, localValue: unknown, carrierHasEntry: boolean): boolean {
  if (carrierHasEntry) return false
  if (key === INBOX_PROJECT_ID_KEY) return readInboxProjectId(localValue) !== null
  if (key === GLOBAL_TASK_ORDER_KEY) return parseTaskOrder(localValue) === localValue && localValue !== DEFAULT_TASK_ORDER
  return false
}
