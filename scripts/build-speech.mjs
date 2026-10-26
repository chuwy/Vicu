#!/usr/bin/env node
// Builds Vicu's local speech engine (native/speech: a small C API over whisper.cpp, the same
// sources as Vicu mobile; docs/ai-assistant-v1.md section 3) as a shared library for this
// platform and architecture, and copies it to resources/speech/ (git-ignored), where the main
// process loads it with koffi (src/main/ai/speech/native.ts) and electron-builder ships it with the
// rest of resources/. The Silero voice detector model is not built: it ships from
// native/speech/models/ (electron-builder.yml, extraResources).
//
//   node scripts/build-speech.mjs [--arch arm64|x64] [--if-stale] [--optional]
//                                 [--whisper-source <dir>] [--clean]
//
// --whisper-source (or VICU_WHISPER_SOURCE_DIR) points at an unpacked whisper.cpp 1.9.5 for an
// offline build; otherwise CMake downloads the pinned release and checks its SHA-256.
// --optional exits 0 with a warning when CMake is missing (a local `npm run build` without the
// native tools still works; the app then uses the platform recogniser, section 3.6). The dist
// scripts and CI run it without --optional, so a release never ships without the engine.
//
// CMake 3.22 or newer is needed; Ninja is used when found (on macOS the Android SDK's copies under
// ~/Library/Android/sdk/cmake/<version>/bin are found too). Windows uses the Visual Studio
// generator, and the C++ runtime is linked in statically.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'native', 'speech')
const outDir = join(root, 'resources', 'speech')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const platform = process.platform
const arch = option('--arch') ?? process.arch
const whisperSource = option('--whisper-source') ?? process.env.VICU_WHISPER_SOURCE_DIR
const libName = platform === 'darwin' ? 'libvicu_speech.dylib' : platform === 'win32' ? 'vicu_speech.dll' : 'libvicu_speech.so'
const out = join(outDir, libName)

function log(message) {
  console.log(`[speech] ${message}`)
}

function exe(name) {
  return platform === 'win32' ? `${name}.exe` : name
}

/** A tool on PATH, or in the Android SDK's CMake folders (where CMake and Ninja live on many Macs). */
function findTool(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, exe(name)))) return join(dir, exe(name))
  }
  const sdks = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ].filter(Boolean)
  for (const sdk of sdks) {
    const cmakeRoot = join(sdk, 'cmake')
    if (!existsSync(cmakeRoot)) continue
    const versions = readdirSync(cmakeRoot).sort().reverse()
    for (const version of versions) {
      const candidate = join(cmakeRoot, version, 'bin', exe(name))
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function newestSource() {
  let newest = 0
  for (const name of ['vicu_speech.h', 'vicu_speech.cpp', 'CMakeLists.txt']) {
    newest = Math.max(newest, statSync(join(sourceDir, name)).mtimeMs)
  }
  newest = Math.max(newest, statSync(fileURLToPath(import.meta.url)).mtimeMs)
  return newest
}

if (flag('--if-stale') && existsSync(out) && statSync(out).mtimeMs >= newestSource()) {
  log('up to date')
  process.exit(0)
}

const cmake = findTool('cmake')
if (!cmake) {
  const message = 'CMake was not found (PATH or the Android SDK). Install CMake 3.22 or newer to build the local speech engine.'
  if (flag('--optional')) {
    console.warn(`[speech] ${message} Skipping: the app will use the platform recogniser.`)
    process.exit(0)
  }
  console.error(`[speech] ${message}`)
  process.exit(1)
}
// Windows uses the Visual Studio generator, which finds the compiler without a developer prompt.
const ninja = platform === 'win32' ? null : findTool('ninja')

const buildDir = join(root, '.speech-build', `${platform}-${arch}`)
if (flag('--clean')) rmSync(buildDir, { recursive: true, force: true })
mkdirSync(buildDir, { recursive: true })

const configure = ['-S', sourceDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release', '-DVICU_SPEECH_SHARED=ON']
if (ninja) configure.push('-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${ninja}`)
else if (platform === 'win32') configure.push('-A', arch === 'arm64' ? 'ARM64' : 'x64')
if (whisperSource) configure.push(`-DVICU_WHISPER_SOURCE_DIR=${whisperSource}`)
// The C++ runtime goes inside the DLL, so no Visual C++ redistributable is needed.
if (platform === 'win32') configure.push('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
if (platform === 'darwin') {
  // The DMG is built per architecture (electron-builder.yml: arm64); the library matches it.
  configure.push(`-DCMAKE_OSX_ARCHITECTURES=${arch === 'x64' ? 'x86_64' : 'arm64'}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0')
}

log(`configuring for ${platform}-${arch} with ${cmake}${ninja ? ' and Ninja' : ''}`)
execFileSync(cmake, configure, { stdio: 'inherit' })
log('building')
execFileSync(cmake, ['--build', buildDir, '--config', 'Release', '--target', 'vicu_speech', '--parallel'], { stdio: 'inherit' })

/** The built library: in the build folder itself (Ninja, Makefiles) or under Release/ (Visual Studio). */
function builtLibrary() {
  const names = platform === 'win32' ? ['vicu_speech.dll', 'libvicu_speech.dll'] : [libName]
  for (const dir of [buildDir, join(buildDir, 'Release'), join(buildDir, 'bin'), join(buildDir, 'bin', 'Release')]) {
    for (const name of names) {
      if (existsSync(join(dir, name))) return join(dir, name)
    }
  }
  return null
}

const built = builtLibrary()
if (!built) {
  console.error(`[speech] the build finished but ${libName} was not found in ${buildDir}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })
copyFileSync(built, out)
if (platform === 'darwin') {
  // Ad-hoc signature for local runs; a release build is signed again by electron-builder.
  execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
}
log(`built ${out}`)
