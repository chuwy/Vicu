/**
 * The assistant's provider work in the main process (docs/ai-assistant-v1.md sections 2, 4 and 5):
 * the model list, Test connection, the dictation request and Ask turns. The key never leaves this
 * process. Nothing is sent before a provider is set up and, for a cloud provider, the user agreed
 * (7.1).
 */
import {
  DICTATION_ANSWER_SCHEMA,
  PROBE,
  askSystemPrompt,
  dictationSystemPrompt,
  enabledAskTools,
  providerPreset,
  type StructuredMode,
} from '../../shared/ai/contract'
import { capabilitiesOf, hasConsent, isSetUp, modelKey } from '../../shared/ai/settings'
import { extractJsonObject } from '../../shared/ai/schema'
import type {
  AiError,
  AiResult,
  AiSettings,
  AskTurnEvent,
  AskTurnRequest,
  ConnectionTestResult,
  ToolSpec,
} from '../../shared/ai/types'
import { AiFailure, listModels, providerConnection, runChat, type ProviderConnection } from './client'
import { getAiSettings, getProviderKey, updateAiSettings } from './settings-store'
import { structuredAnswer } from './structured'
import { nodeTransport, type Transport } from './transport'

export const DICTATION_IDLE_MS = 60_000
export const ASK_IDLE_MS = 120_000
export const DICTATION_MAX_TOKENS = 8192
export const ASK_MAX_TOKENS = 16000
const PROBE_MAX_TOKENS = 2048

let transport: Transport = nodeTransport

/** Test hook: a fake transport. */
export function setAiTransport(next: Transport | null): void {
  transport = next ?? nodeTransport
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiFailure) return { kind: err.kind, message: err.message, ...(err.status ? { status: err.status } : {}) }
  return { kind: 'network', message: err instanceof Error ? err.message : 'The request failed.' }
}

function connectionOf(settings: AiSettings): ProviderConnection {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset || !isSetUp(settings, getProviderKey() !== null)) throw new AiFailure('not_set_up', 'Set up a provider in Settings, Assistant first.')
  if (!hasConsent(settings)) throw new AiFailure('no_consent', 'Agree to what the assistant sends in Settings, Assistant first.')
  return providerConnection(preset, settings.address, getProviderKey())
}

function refusedFor(settings: AiSettings, model: string): string[] {
  return settings.refusedFields[modelKey(settings, model)] ?? []
}

function rememberRefused(model: string) {
  return (field: string) => {
    void updateAiSettings((current) => {
      const key = modelKey(current, model)
      const fields = new Set(current.refusedFields[key] ?? [])
      fields.add(field)
      return { ...current, refusedFields: { ...current.refusedFields, [key]: [...fields] } }
    })
  }
}

async function wrap<T>(run: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { success: true, data: await run() }
  } catch (err) {
    return { success: false, error: toAiError(err) }
  }
}

export function aiListModels(): Promise<AiResult<string[]>> {
  return wrap(async () => listModels(connectionOf(getAiSettings()), transport))
}

function sameValues(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false
  const object = actual as Record<string, unknown>
  return Object.entries(expected).every(([key, value]) => object[key] === value)
}

/**
 * Test connection (2.4) on one model: the model list, one structured answer (json_schema first,
 * then prompt; the one that works is kept for the model) and one tool call.
 */
export function aiTestConnection(model: string): Promise<AiResult<ConnectionTestResult>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const name = model.trim()
    if (!name) throw new AiFailure('bad_request', 'Choose a model first.')
    const result: ConnectionTestResult = {
      models: { ok: false, count: 0 },
      structured: { ok: false, mode: null },
      tool: { ok: false },
      features: { dictation: false, ask: false, talk: false },
    }
    try {
      const models = await listModels(connection, transport)
      result.models = { ok: true, count: models.length }
    } catch (err) {
      result.models = { ok: false, count: 0, error: toAiError(err).message }
    }

    const preset = providerPreset(settings.provider ?? '')
    const modes: StructuredMode[] = preset?.structured === 'prompt' ? ['prompt'] : ['json_schema', 'prompt']
    for (const mode of modes) {
      try {
        const answer = await structuredAnswer(connection, {
          model: name,
          system: '',
          user: PROBE.structured.user,
          schema: PROBE.structured.schema,
          mode,
          maxTokens: PROBE_MAX_TOKENS,
        }, { transport, idleTimeoutMs: DICTATION_IDLE_MS, refused: refusedFor(settings, name), onRefused: rememberRefused(name) })
        if (sameValues(answer, PROBE.structured.expect)) {
          result.structured = { ok: true, mode }
          break
        }
        result.structured = { ok: false, mode: null, error: `The answer was ${JSON.stringify(answer)}.` }
      } catch (err) {
        result.structured = { ok: false, mode: null, error: toAiError(err).message }
        if (err instanceof AiFailure && (err.kind === 'auth' || err.kind === 'network' || err.kind === 'not_found')) break
      }
    }

    try {
      const tool: ToolSpec = PROBE.tool.tool
      const { message } = await runChat(connection, {
        model: name,
        system: '',
        messages: [{ role: 'user', text: PROBE.tool.user }],
        tools: [tool],
        deterministic: false,
        maxTokens: PROBE_MAX_TOKENS,
      }, { transport, idleTimeoutMs: ASK_IDLE_MS, refused: refusedFor(settings, name) })
      const call = message.toolCalls.find((c) => c.name === tool.name)
      let args: unknown = null
      try {
        args = call ? extractJsonObject(call.arguments || '{}') : null
      } catch {
        args = null
      }
      if (call && sameValues(args, PROBE.tool.expectArguments)) result.tool = { ok: true }
      else result.tool = { ok: false, error: call ? 'The model called the tool with other numbers.' : 'The model did not call the tool.' }
    } catch (err) {
      result.tool = { ok: false, error: toAiError(err).message }
    }

    result.features = {
      dictation: result.structured.ok,
      ask: result.structured.ok && result.tool.ok,
      talk: result.structured.ok && result.tool.ok,
    }
    await updateAiSettings((current) => ({
      ...current,
      tested: { ...current.tested, [modelKey(current, name)]: { structured: result.structured.mode, tools: result.tool.ok } },
    }))
    return result
  })
}

/** One dictation request (4.1, 4.4): the answer checked against the schema, repaired once. */
export function aiDictate(input: { edit: boolean; user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const model = settings.models.dictation
    if (!model) throw new AiFailure('not_set_up', 'Choose a dictation model in Settings, Assistant.')
    const mode = capabilitiesOf(settings, model)?.structured ?? providerPreset(settings.provider ?? '')?.structured ?? 'json_schema'
    return structuredAnswer(connection, {
      model,
      system: dictationSystemPrompt(input.edit),
      user: input.user,
      schema: DICTATION_ANSWER_SCHEMA,
      mode,
      maxTokens: DICTATION_MAX_TOKENS,
    }, { transport, idleTimeoutMs: DICTATION_IDLE_MS, signal, refused: refusedFor(settings, model), onRefused: rememberRefused(model) })
  })
}

const askTurns = new Map<string, AbortController>()

/** One Ask round (5.1): streams the text, ends with the whole assistant message (tool calls included). */
export async function aiAskTurn(request: AskTurnRequest, emit: (event: AskTurnEvent) => void): Promise<void> {
  const controller = new AbortController()
  askTurns.set(request.turnId, controller)
  try {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const model = settings.models.ask
    if (!model) throw new AiFailure('not_set_up', 'Choose an Ask model in Settings, Assistant.')
    const tools: ToolSpec[] = enabledAskTools().map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    // The last round leaves the tools out (5.5); the Messages API needs them defined while the
    // history holds tool blocks, so there they stay with tool_choice none.
    const anthropic = connection.protocol === 'anthropic-messages'
    const { message, stopReason } = await runChat(connection, {
      model,
      system: askSystemPrompt(request.talk),
      messages: request.messages,
      tools: request.final && !anthropic ? [] : tools,
      toolsOff: request.final && anthropic,
      deterministic: false,
      maxTokens: ASK_MAX_TOKENS,
    }, {
      transport,
      idleTimeoutMs: ASK_IDLE_MS,
      signal: controller.signal,
      refused: refusedFor(settings, model),
      onRefused: rememberRefused(model),
      onText: (text) => emit({ type: 'text', text }),
    })
    emit({ type: 'done', message, stopReason })
  } catch (err) {
    emit({ type: 'error', error: toAiError(err) })
  } finally {
    askTurns.delete(request.turnId)
  }
}

export function cancelAskTurn(turnId: string): boolean {
  const controller = askTurns.get(turnId)
  if (!controller) return false
  controller.abort()
  return true
}

export function cancelAllAskTurns(): void {
  for (const controller of askTurns.values()) controller.abort()
  askTurns.clear()
}
