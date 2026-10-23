#!/usr/bin/env node
// Serves site/ the way GitHub Pages does, for a local preview.
//
//   node site/tools/serve.mjs [port]      (default 8096, or $PORT) then open http://127.0.0.1:8096/
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 8096)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = normalize(join(ROOT, path))
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end()
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) {
    const notFound = join(ROOT, '404.html')
    res.writeHead(404, { 'content-type': TYPES['.html'] })
    if (existsSync(notFound)) createReadStream(notFound).pipe(res)
    else res.end('Not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => console.log(`site: http://127.0.0.1:${PORT}/`))
