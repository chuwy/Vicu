/**
 * One request to the user's AI provider (docs/ai-assistant-v1.md section 2): the body by the wire
 * protocol, sent through the transport, the streamed answer read back. A 400 that names an optional
 * field (`temperature`, `reasoning_effort`, `effort`) is tried once more without it, and the caller
 * remembers that for the model. Also the model list (2.1).
 */
import { PROTOCOLS, type ProviderPreset, type WireProtocol } from '../../shared/ai/contract'
import type { AiErrorKind } from '../../shared/ai/types'
import { SseReader } from './sse'
import { readText, TransportError, type Transport } from './transport'
import {
  OPTIONAL_FIELDS,
  ProviderAnswerError,
  providerErrorText,
  refusedOptionalField,
  wireProtocol,
  type AssistantMessage,
  type ChatRequest,
} from './wire'

export class AiFailure extends Error {
  constructor(readonly kind: AiErrorKind, message: string, readonly status?: number) {
    super(message)
  }
}

export interface ProviderConnection {
  protocol: WireProtocol
  /** Without a trailing `/`. */
  address: string
  headers: Record<string, string>
}

export const CONNECT_TIMEOUT_MS = 10_000

/** The address as used: trimmed, without trailing slashes. */
export function normaliseAddress(address: string): string {
  return address.trim().replace(/\/+$/, '')
}

/** How requests reach a preset: its address (or the typed one where editable), the key header and its own headers. */
export function providerConnection(preset: ProviderPreset, address: string, key: string | null): ProviderConnection {
  const headers: Record<string, string> = { ...preset.headers }
  if (key) headers[preset.auth.header] = `${preset.auth.prefix}${key}`
  return {
    protocol: preset.protocol,
    address: normaliseAddress(preset.addressEditable ? address : (preset.address ?? address)),
    headers,
  }
}

function kindOfStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'bad_request'
}

function errorMessage(body: string, status: number): string {
  try {
    const message = providerErrorText(JSON.parse(body))
    if (message !== 'The provider reported an error.') return message
  } catch {
    // not JSON
  }
  const text = body.trim()
  if (text && text.length < 300 && !text.startsWith('<')) return text
  return `The provider answered ${status}.`
}

function toFailure(err: unknown): AiFailure {
  if (err instanceof AiFailure) return err
  if (err instanceof TransportError) return new AiFailure(err.kind === 'cancelled' ? 'cancelled' : err.kind, err.message)
  if (err instanceof ProviderAnswerError) return new AiFailure(err.kind, err.message)
  return new AiFailure('network', err instanceof Error ? err.message : 'The request failed.')
}

export interface RunChatOptions {
  transport: Transport
  idleTimeoutMs: number
  signal?: AbortSignal
  /** Fields this model refused before: never sent. */
  refused?: readonly string[]
  /** A field the model refused now (remember it for the model). */
  onRefused?: (field: string) => void
  onText?: (text: string) => void
}

export async function runChat(
  connection: ProviderConnection,
  request: ChatRequest,
  options: RunChatOptions,
): Promise<{ message: AssistantMessage; stopReason: string | null }> {
  const protocol = wireProtocol(connection.protocol)
  const omit = new Set<string>(options.refused ?? [])
  for (let attempt = 0; attempt <= OPTIONAL_FIELDS.length; attempt++) {
    const body = protocol.body(request, omit)
    let response
    try {
      response = await options.transport({
        url: connection.address + PROTOCOLS[connection.protocol].chat,
        method: 'POST',
        headers: { ...connection.headers, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        idleTimeoutMs: options.idleTimeoutMs,
        signal: options.signal,
      })
    } catch (err) {
      throw toFailure(err)
    }
    try {
      if (response.status < 200 || response.status >= 300) {
        const text = await readText(response.body)
        const message = errorMessage(text, response.status)
        if (response.status === 400) {
          const field = refusedOptionalField(message, connection.protocol, body)
          if (field && !omit.has(field)) {
            omit.add(field)
            options.onRefused?.(field)
            continue
          }
        }
        throw new AiFailure(kindOfStatus(response.status), message, response.status)
      }
      const reader = protocol.reader()
      const contentType = String(response.headers['content-type'] ?? '')
      if (contentType.includes('text/event-stream')) {
        const sse = new SseReader()
        const decoder = new TextDecoder()
        const handle = (events: ReturnType<SseReader['feed']>) => {
          for (const event of events) {
            const piece = reader.onData(event.data)
            if (piece) options.onText?.(piece)
          }
        }
        for await (const chunk of response.body) handle(sse.feed(decoder.decode(chunk, { stream: true })))
        handle(sse.feed(decoder.decode()))
        handle(sse.end())
      } else {
        const piece = reader.onWhole(await readText(response.body))
        if (piece) options.onText?.(piece)
      }
      return reader.finish()
    } catch (err) {
      throw toFailure(err)
    }
  }
  throw new AiFailure('bad_request', 'The provider refused the request.')
}

/** The models the provider lists at `<address>/models` (anthropic-messages pages with `after_id`). */
export async function listModels(connection: ProviderConnection, transport: Transport, signal?: AbortSignal): Promise<string[]> {
  const ids: string[] = []
  let after: string | null = null
  for (let page = 0; page < 20; page++) {
    let url = connection.address + PROTOCOLS[connection.protocol].models
    if (connection.protocol === 'anthropic-messages') url += `?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
    let response
    try {
      response = await transport({
        url,
        method: 'GET',
        headers: { ...connection.headers, accept: 'application/json' },
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        idleTimeoutMs: 30_000,
        signal,
      })
    } catch (err) {
      throw toFailure(err)
    }
    let text: string
    try {
      text = await readText(response.body)
    } catch (err) {
      throw toFailure(err)
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AiFailure(kindOfStatus(response.status), errorMessage(text, response.status), response.status)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AiFailure('bad_answer', 'The model list could not be read.')
    }
    const object = parsed as { data?: unknown; models?: unknown; has_more?: unknown; last_id?: unknown }
    const list = Array.isArray(object.data) ? object.data : Array.isArray(object.models) ? object.models : Array.isArray(parsed) ? parsed : []
    for (const entry of list) {
      const id = typeof entry === 'string' ? entry : (entry as { id?: unknown; name?: unknown })?.id ?? (entry as { name?: unknown })?.name
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
    }
    if (connection.protocol === 'anthropic-messages' && object.has_more === true && typeof object.last_id === 'string') {
      after = object.last_id
      continue
    }
    break
  }
  return ids
}
