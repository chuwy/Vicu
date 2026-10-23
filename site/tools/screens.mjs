#!/usr/bin/env node
// Turns harness captures into the website's WebP screens (site/assets/img/screens/).
//
//   node site/tools/screens.mjs desktop <light run folder> <dark run folder>
//   node site/tools/screens.mjs mobile <folder of phone PNGs>
//
// Desktop runs come from `npm run ui:verify -- --scenario site-screens --scale 2 --theme light|dark
// --run site-light|site-dark` (scripts/ui-verify/out/<run>). Phone PNGs keep their names
// (android-today-light.png -> android-today-light.webp). Needs `cwebp` (brew install webp).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'img', 'screens')
mkdirSync(OUT, { recursive: true })

// Window captures are 2560x1600; the site shows them at most about 1100 px wide.
const DESKTOP_WIDTH = 1600
const PHONE_WIDTH = 780

function webp(src, dest, width) {
  const args = ['-quiet', '-q', '84', '-m', '6', '-alpha_q', '100']
  if (width) args.push('-resize', String(width), '0')
  const r = spawnSync('cwebp', [...args, src, '-o', dest], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`cwebp failed for ${src}`)
  console.log(basename(dest))
}

const [mode, ...dirs] = process.argv.slice(2)
if (mode === 'desktop') {
  const [light, dark] = dirs.map((d) => resolve(d))
  for (const [dir, suffix] of [[light, ''], [dark, '-dark']]) {
    if (!dir || !existsSync(dir)) throw new Error(`no such run folder: ${dir}`)
    for (const f of readdirSync(dir).filter((n) => n.startsWith('site-screens--') && n.endsWith('.png'))) {
      const name = f.replace('site-screens--', '').replace('.png', '')
      // The popup windows are small: keep their 2x pixels.
      const width = name.startsWith('quick-') ? undefined : DESKTOP_WIDTH
      webp(join(dir, f), join(OUT, `desktop-${name}${suffix}.webp`), width)
    }
  }
} else if (mode === 'mobile') {
  const dir = resolve(dirs[0] ?? '')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    webp(join(dir, f), join(OUT, f.replace('.png', '.webp')), PHONE_WIDTH)
  }
} else {
  console.error('usage: screens.mjs desktop <light run> <dark run> | mobile <folder>')
  process.exit(1)
}
