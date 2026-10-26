import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'http'
import { request as httpsRequest } from 'https'
import type { Socket } from 'net'

// HTTP for the AI provider (docs/ai-assistant-v1.md section 2.5), on Node's http and https so the
// two timeouts can be told apart: 10 s to connect, then an idle limit (60 s for dictation, 120 s
// for Ask) on waiting for data, the first byte included, because a local model may take long to
// start. Keys travel in headers and are never logged: `redactHeaders` hides them in debug output.

export interface HttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  connectTimeoutMs: number
  idleTimeoutMs: number
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Buffer>
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>

export class TransportError extends Error {
  constructor(readonly kind: 'network' | 'timeout' | 'cancelled', message: string) {
    super(message)
  }
}

const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'x-goog-api-key'])

/** Headers safe for a log line: the key headers show as `[redacted]`. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? '[redacted]' : value
  return out
}

/** Debug output of a request, only with VICU_AI_DEBUG set; never the body or a key. */
export function debugRequest(request: Pick<HttpRequest, 'method' | 'url' | 'headers'>): void {
  if (!process.env.VICU_AI_DEBUG) return
  console.log('[AI]', request.method, request.url, JSON.stringify(redactHeaders(request.headers)))
}

export const nodeTransport: Transport = (options) => new Promise((resolve, reject) => {
  let url: URL
  try {
    url = new URL(options.url)
  } catch {
    reject(new TransportError('network', 'The address is not valid.'))
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    reject(new TransportError('network', 'The address must start with http:// or https://.'))
    return
  }
  debugRequest(options)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  let settled = false
  const fail = (error: TransportError) => {
    if (settled) return
    settled = true
    reject(error)
  }

  const req: ClientRequest = send(url, {
    method: options.method,
    headers: { ...options.headers, ...(options.body !== undefined ? { 'content-length': Buffer.byteLength(options.body) } : {}) },
  })

  // Why this side ended the request (a timeout or a cancel), so the reader can say so.
  let ended: TransportError | null = null
  const end = (reason: TransportError) => {
    ended ??= reason
    req.destroy(reason)
  }
  const connectTimer = setTimeout(() => end(new TransportError('timeout', 'Could not connect to the provider in time.')), options.connectTimeoutMs)
  const idle = () => end(new TransportError('timeout', 'The model did not answer in time.'))
  req.on('socket', (socket: Socket) => {
    const connected = () => {
      clearTimeout(connectTimer)
      req.setTimeout(options.idleTimeoutMs, idle)
    }
    if (socket.connecting) socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected)
    else connected()
  })

  const onAbort = () => end(new TransportError('cancelled', 'Cancelled.'))
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  req.on('error', (err) => {
    clearTimeout(connectTimer)
    fail(err instanceof TransportError ? err : new TransportError('network', `Could not reach the provider (${err.message}).`))
  })

  req.on('response', (res: IncomingMessage) => {
    clearTimeout(connectTimer)
    settled = true
    resolve({
      status: res.statusCode ?? 0,
      headers: res.headers,
      body: (async function* () {
        try {
          for await (const chunk of res) yield chunk as Buffer
        } catch (err) {
          // A destroyed request (idle timeout, cancel) says why on the request, not on the stream.
          const reason = ended ?? err
          throw reason instanceof TransportError ? reason : new TransportError('network', 'The connection to the provider broke off.')
        } finally {
          options.signal?.removeEventListener('abort', onAbort)
        }
        // A destroyed request ends the response early; say why.
        if (ended) throw ended
        if (!res.complete) throw new TransportError('network', 'The connection to the provider broke off.')
      })(),
    })
  })

  if (options.body !== undefined) req.write(options.body)
  req.end()
})

/** The whole body as text. */
export async function readText(body: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
