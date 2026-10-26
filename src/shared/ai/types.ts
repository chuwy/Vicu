/**
 * What the windows and the main process exchange about the AI assistant (docs/ai-assistant-v1.md).
 * The provider key never crosses IPC: the windows only learn whether one is saved.
 */
import type { JsonSchema, ProviderId, StructuredMode } from './contract'

// --- Conversations on the wire ------------------------------------------------------------

export interface ToolCall {
  id: string
  name: string
  /** The arguments as the model sent them (JSON text, maybe incomplete). */
  arguments: string
}

export interface ToolResult {
  callId: string
  name: string
  /** JSON text. */
  content: string
  /** Invalid arguments (2.3). */
  isError?: boolean
}

/**
 * One message of a conversation in a provider-neutral shape. An assistant turn of
 * `anthropic-messages` keeps its content blocks exactly as received (`raw`, thinking blocks and
 * their signatures included), and they are sent back as they came.
 */
export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown[] }
  | { role: 'tool'; results: ToolResult[] }

export interface ToolSpec {
  name: string
  description: string
  parameters: JsonSchema
}

export type AiErrorKind =
  | 'not_set_up'
  | 'no_consent'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'bad_request'
  | 'refused'
  | 'bad_answer'
  | 'cancelled'

export interface AiError {
  kind: AiErrorKind
  message: string
  status?: number
}

// --- Settings -----------------------------------------------------------------------------

export interface ModelCapabilities {
  /** The structured mode that worked, or null when neither did. */
  structured: StructuredMode | null
  /** The model called the probe tool. */
  tools: boolean
}

/** The assistant's settings on this device (7.2): never synced, never in the prefs carrier. */
export interface AiSettings {
  provider: ProviderId | null
  /** The address requests go to, without a trailing `/`. */
  address: string
  models: { dictation: string; ask: string }
  features: { dictation: boolean; ask: boolean; talk: boolean }
  /** What Test connection found, per `provider|address|model`. */
  tested: Record<string, ModelCapabilities>
  /** Provider and address pairs the user agreed to send data to (7.1), `provider|address`. */
  consented: string[]
  /** Fields a model refused with a 400 (`temperature`, `reasoning_effort`, `effort`), per `provider|address|model`. */
  refusedFields: Record<string, string[]>
  speech: {
    /** A `speech.models` id to use when downloaded; null: the platform recogniser (3.6). */
    modelId: string | null
    /** `auto` or an ISO 639-1 code (3.3). */
    language: string
  }
  /** Talk reads answers aloud with the system voice. */
  speakAnswers: boolean
}

/** What a window sees: the settings and whether a key is saved, never the key. */
export interface AiSettingsView extends AiSettings {
  hasKey: boolean
}

/** A change to the settings. Nested groups merge per key in main, so a patch names only what changed (two quick saves never undo each other). */
export type AiSettingsPatch = Partial<Omit<AiSettings, 'tested' | 'refusedFields' | 'models' | 'features' | 'speech'>> & {
  models?: Partial<AiSettings['models']>
  features?: Partial<AiSettings['features']>
  speech?: Partial<AiSettings['speech']>
}

export interface ConnectionTestResult {
  models: { ok: boolean; count: number; error?: string }
  structured: { ok: boolean; mode: StructuredMode | null; error?: string }
  tool: { ok: boolean; error?: string }
  /** Which features the model can run. */
  features: { dictation: boolean; ask: boolean; talk: boolean }
}

export type AiResult<T> = { success: true; data: T } | { success: false; error: AiError }

// --- Ask streaming ------------------------------------------------------------------------

export interface AskTurnRequest {
  turnId: string
  talk: boolean
  messages: ChatMessage[]
  /** The last round (5.5): the tools left out. */
  final: boolean
}

export type AskTurnEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; message: Extract<ChatMessage, { role: 'assistant' }>; stopReason: string | null }
  | { type: 'error'; error: AiError }

export interface AskTurnEnvelope {
  turnId: string
  event: AskTurnEvent
}

// --- Conversations and kept transcripts (device only) -------------------------------------

export interface StoredConversationMessage {
  /** When it was added, ms since the epoch. */
  at: number
  message: ChatMessage
}

export interface StoredConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  talk: boolean
  messages: StoredConversationMessage[]
  /** Ids of the tasks a tool returned in this conversation (5.1: only these render as rows). */
  taskIds: number[]
}

/** A transcript kept after a failed dictation request (4.6), until it is added or discarded. */
export interface KeptTranscript {
  id: string
  transcript: string
  /** When the recording ended, local `YYYY-MM-DDTHH:mm:ss`. */
  reference: string
  error: string
  /** The list's defaults when it was recorded. */
  list: { name: string; projectId: number | null; defaultDue: string | null } | null
  /** Break into steps: the parent task. */
  parentTaskId?: number | null
}

// --- Local speech -------------------------------------------------------------------------

export interface SpeechModelState {
  id: string
  downloaded: boolean
  /** Bytes on disk while a download runs or after it paused. */
  downloadedBytes: number
  downloading: boolean
  error?: string
}

export interface SpeechStatus {
  /** The engine is part of this build. */
  engine: boolean
  models: SpeechModelState[]
  /** The model local speech uses now (chosen and downloaded), or null. */
  activeModelId: string | null
}

export interface SpeechStartOptions {
  /** `auto` or an ISO 639-1 code. */
  language?: string
  /** The vocabulary hint (3.4), or null. */
  hint?: string | null
}

export type SpeechEvent =
  | { type: 'ready' }
  /** The transcript of the phrases finished so far. */
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export interface SpeechEventEnvelope {
  sessionId: number
  event: SpeechEvent
}

export interface SpeechDownloadProgress {
  id: string
  downloadedBytes: number
  totalBytes: number
  done: boolean
  error?: string
}
