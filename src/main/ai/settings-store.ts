import { app, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readFileWithBackup, removeFileAndBackup, writeFileAtomic } from '../atomic-file'
import { JsonFileStore } from '../json-file-store'
import { DEFAULT_AI_SETTINGS, normaliseAiSettings } from '../../shared/ai/settings'
import type { AiSettings, AiSettingsPatch, AiSettingsView } from '../../shared/ai/types'

// The assistant's device settings (docs/ai-assistant-v1.md section 7.2) in userData/ai-settings.json,
// and the provider key in userData/ai-key.json, protected like the Vikunja token in auth.json: the
// OS keychain through safeStorage (a `plain:` value only where encryption is unavailable), file mode
// 600. They belong to the device, not the account: signing out keeps them; never in config.json's
// account data, the synced prefs carrier, a backup of the account or a log line.

let store: JsonFileStore<AiSettings> | null = null

function settingsStore(): JsonFileStore<AiSettings> {
  if (!store) {
    store = new JsonFileStore<AiSettings>({
      path: join(app.getPath('userData'), 'ai-settings.json'),
      backup: true,
      label: 'AI settings',
      empty: () => normaliseAiSettings(DEFAULT_AI_SETTINGS),
      parse: (json) => normaliseAiSettings(json),
    })
    store.load()
  }
  return store
}

export function getAiSettings(): AiSettings {
  return settingsStore().state
}

export async function updateAiSettings(change: (current: AiSettings) => AiSettings): Promise<AiSettings> {
  const s = settingsStore()
  s.state = normaliseAiSettings(change(s.state))
  await s.save()
  return s.state
}

export function patchAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  return updateAiSettings((current) => ({
    ...current,
    ...patch,
    models: { ...current.models, ...(patch.models ?? {}) },
    features: { ...current.features, ...(patch.features ?? {}) },
    speech: { ...current.speech, ...(patch.speech ?? {}) },
  }))
}

export function aiSettingsView(): AiSettingsView {
  return { ...getAiSettings(), hasKey: getProviderKey() !== null }
}

export async function flushAiSettings(): Promise<void> {
  await store?.flush()
}

// --- The key ------------------------------------------------------------------------------

const PLAIN_PREFIX = 'plain:'
let keyMemory: { path: string; key: string | null } | null = null

function keyPath(): string {
  return join(app.getPath('userData'), 'ai-key.json')
}

function encrypt(value: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return PLAIN_PREFIX + value
    return safeStorage.encryptString(value).toString('base64')
  } catch {
    return PLAIN_PREFIX + value
  }
}

function decrypt(encoded: string): string | null {
  if (encoded.startsWith(PLAIN_PREFIX)) return encoded.slice(PLAIN_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    console.warn('[AI] The saved provider key could not be decrypted.')
    return null
  }
}

/** The provider key, or null. Read from disk once and kept in memory. */
export function getProviderKey(): string | null {
  const path = keyPath()
  if (keyMemory && keyMemory.path === path) return keyMemory.key
  let key: string | null = null
  if (existsSync(path)) {
    const result = readFileWithBackup(path, (raw) => JSON.parse(raw) as { key?: unknown })
    if (result && typeof result.value.key === 'string') key = decrypt(result.value.key)
  }
  keyMemory = { path, key }
  return key
}

/** Saves the key (or removes it with null or an empty string). */
export function setProviderKey(key: string | null): void {
  const path = keyPath()
  const value = key?.trim() ?? ''
  if (value === '') {
    removeFileAndBackup(path)
    keyMemory = { path, key: null }
    return
  }
  writeFileAtomic(path, JSON.stringify({ key: encrypt(value) }), { backup: true, mode: 0o600 })
  keyMemory = { path, key: value }
}
