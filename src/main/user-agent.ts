import { app } from 'electron'
import { hostname } from 'node:os'

// The User-Agent of every request to the Vikunja server. Vikunja keeps the one of the
// sign-in request as the session's device and lists it as it is under Settings, Sessions,
// where Electron's default (a long Chromium string) said nothing about which computer it
// was. It names the app, its version, the platform and this computer:
// `Vicu/2.5.1 (Windows; DESKTOP-4K2H1)`. The mobile app sends the same form with the
// phone's model (VikunjaUserAgent.kt).

const PRODUCT = 'Vicu'
const MAX_PART_LENGTH = 64

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}

export function platformName(platform: NodeJS.Platform): string {
  return PLATFORM_NAMES[platform] ?? platform
}

/**
 * A header value is printable ASCII (Chromium refuses anything else), and a comment cannot
 * hold its own delimiters, so "Rendy’s PC (2)" becomes "Rendys PC 2".
 */
function commentPart(text: string): string {
  return text
    .replace(/[^\x20-\x7e]|[();\\]/g, '')
    .split(' ')
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_PART_LENGTH)
    .trimEnd()
}

export function buildUserAgent(version: string, platform: string, machine: string): string {
  const cleanVersion = version.replace(/[^A-Za-z0-9.+_-]/g, '')
  const product = cleanVersion ? `${PRODUCT}/${cleanVersion}` : PRODUCT
  const details = [platform, machine].map(commentPart).filter(Boolean)
  return details.length > 0 ? `${product} (${details.join('; ')})` : product
}

let cached: string | null = null

export function vikunjaUserAgent(): string {
  if (cached) return cached
  let version = ''
  try {
    version = app.getVersion()
  } catch {
    // Only in tests that mock electron without it; the agent then names no version.
  }
  cached = buildUserAgent(version, platformName(process.platform), hostname())
  return cached
}
