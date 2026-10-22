#!/usr/bin/env node
// Builds the macOS speech helper (native/voice-macos/VicuSpeech.swift) into
// resources/voice/vicu-speech-macos, a universal binary (arm64 + x86_64) with the helper's
// Info.plist linked in (the usage strings macOS shows when it asks for the microphone and speech
// recognition). electron-builder ships it with the rest of resources/ and signs it with the
// app's entitlements. On other systems this does nothing: Windows uses resources/voice/voice-windows.ps1
// and Linux has no engine (docs/voice-input.md).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'voice-macos', 'VicuSpeech.swift')
const plist = join(root, 'native', 'voice-macos', 'Info.plist')
const outDir = join(root, 'resources', 'voice')
const out = join(outDir, 'vicu-speech-macos')

if (process.platform !== 'darwin') {
  console.log('[voice-helper] not macOS: nothing to build')
  process.exit(0)
}

const ifStale = process.argv.includes('--if-stale')
if (ifStale && existsSync(out)) {
  const built = statSync(out).mtimeMs
  if (built >= statSync(source).mtimeMs && built >= statSync(plist).mtimeMs) {
    console.log('[voice-helper] up to date')
    process.exit(0)
  }
}

mkdirSync(outDir, { recursive: true })
const parts = []
for (const arch of ['arm64', 'x86_64']) {
  const part = `${out}-${arch}`
  execFileSync('xcrun', [
    'swiftc', '-O',
    '-target', `${arch}-apple-macos11`,
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist,
    '-o', part,
    source,
  ], { stdio: 'inherit' })
  parts.push(part)
}
execFileSync('lipo', ['-create', ...parts, '-output', out], { stdio: 'inherit' })
for (const part of parts) rmSync(part, { force: true })
// Ad-hoc signature for local runs; a release build is signed again by electron-builder.
execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
console.log(`[voice-helper] built ${out}`)
