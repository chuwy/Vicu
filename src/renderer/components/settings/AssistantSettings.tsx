import { useEffect, useId, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Loader2, Pause, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Switch } from '@/components/shared/Switch'
import { Dialog } from '@/components/overlay/Dialog'
import { cn } from '@/lib/cn'
import {
  AI_SETTINGS_QUERY_KEY,
  SPEECH_STATUS_QUERY_KEY,
  useAiSettings,
  useSaveAiSettings,
  useSpeechStatus,
} from '@/hooks/use-ai'
import { useAskStore } from '@/stores/ask-store'
import { toast } from '@/stores/toast-store'
import { PROVIDER_PRESETS, SPEECH, providerPreset } from '../../../shared/ai/contract'
import {
  capabilitiesOf,
  consentKey,
  effectiveAddress,
  hasConsent,
  isCleartextToRemoteHost,
  isSetUp,
} from '../../../shared/ai/settings'
import type { AiSettingsView, ConnectionTestResult, SpeechDownloadProgress } from '../../../shared/ai/types'

const CARD = 'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5'
const INPUT = 'w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]'
const LABEL = 'mb-1 block text-xs text-[var(--text-secondary)]'

const LANGUAGES: Array<[string, string]> = [
  ['auto', 'Detect per phrase'], ['en', 'English'], ['nl', 'Dutch'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['sv', 'Swedish'], ['da', 'Danish'], ['pl', 'Polish'], ['cs', 'Czech'],
  ['fi', 'Finnish'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
]

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/**
 * Settings, Assistant (docs/ai-assistant-v1.md sections 2, 3 and 7): the provider, its address and
 * key, the models per feature, Test connection, the feature switches, the consent sheet, and local
 * speech's models. Everything here belongs to this device: it is not synced and stays when you sign
 * out; the key is kept by the main process in the system's secret store and never shown again.
 */
export function AssistantSettings() {
  const { data: settings } = useAiSettings()
  if (!settings) return null
  return (
    <>
      <ProviderCard settings={settings} />
      <ModelsCard settings={settings} />
      <SpeechCard settings={settings} />
      <PrivacyCard />
    </>
  )
}

function ProviderCard({ settings }: { settings: AiSettingsView }) {
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  const [address, setAddress] = useState(settings.address)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  useEffect(() => setAddress(settings.address), [settings.address, settings.provider])

  const chooseProvider = async (id: string) => {
    const next = providerPreset(id)
    if (!next) {
      await save({ provider: null })
      return
    }
    await save({
      provider: next.id,
      address: next.address ?? '',
      models: { dictation: next.suggested.dictation ?? '', ask: next.suggested.ask ?? '' },
      features: { dictation: false, ask: false, talk: false },
    })
  }

  const saveKey = async (value: string | null) => {
    const view = await window.api.ai.setKey(value)
    qc.setQueryData(AI_SETTINGS_QUERY_KEY, view)
    setKey('')
    toast.success(value ? 'Key saved' : 'Key removed')
  }

  const shownAddress = preset?.addressEditable ? address : effectiveAddress(settings)
  const warn = isCleartextToRemoteHost(shownAddress)

  return (
    <section className={CARD} aria-labelledby="ai-provider-heading">
      <h2 id="ai-provider-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Assistant</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Bring your own model for smart dictation, Ask and Talk. Requests go straight from this computer to the provider you choose, with your key; Vicu has no server in between and shows no prices.
      </p>
      <div className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="ai-provider">Provider</label>
          <select
            id="ai-provider"
            value={settings.provider ?? ''}
            onChange={(e) => void chooseProvider(e.target.value)}
            className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          >
            <option value="">Off</option>
            {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {preset && (
          <>
            <div>
              <label className={LABEL} htmlFor="ai-address">Address</label>
              <input
                id="ai-address"
                type="url"
                value={shownAddress}
                disabled={!preset.addressEditable}
                placeholder="https://example.com/v1"
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => { if (preset.addressEditable && address !== settings.address) void save({ address }) }}
                className={cn(INPUT, !preset.addressEditable && 'text-[var(--text-secondary)]')}
              />
              {warn && (
                <p className="mt-1 text-xs text-danger" role="alert">
                  This address is not encrypted (http) and is outside your local network: your key and what you send can be read on the way. Use https.
                </p>
              )}
            </div>

            <div>
              <label className={LABEL} htmlFor="ai-key">
                Key {preset.key === 'optional' ? '(optional)' : ''}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    autoComplete="off"
                    placeholder={settings.hasKey ? 'A key is saved. Paste a new one to replace it.' : 'Paste your key'}
                    onChange={(e) => setKey(e.target.value)}
                    className={cn(INPUT, 'pr-16')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 inline-flex min-h-6 -translate-y-1/2 items-center rounded-control px-2 py-0.5 text-meta text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <Button variant="secondary" disabled={!key.trim()} onClick={() => void saveKey(key)}>Save key</Button>
                {settings.hasKey && <Button variant="quiet" danger onClick={() => void saveKey(null)}>Remove</Button>}
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Kept in this computer’s secret store, like your Vikunja sign-in. It is never synced or shown again.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function ModelsCard({ settings }: { settings: AiSettingsView }) {
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  const [models, setModels] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [results, setResults] = useState<Record<string, ConnectionTestResult | string>>({})
  const [consentFor, setConsentFor] = useState<null | (() => void)>(null)
  const [dictationModel, setDictationModel] = useState(settings.models.dictation)
  const [askModel, setAskModel] = useState(settings.models.ask)
  const listId = useId()
  // Each field follows its own saved value only, so saving one never clears what is being typed in the other.
  useEffect(() => setDictationModel(settings.models.dictation), [settings.models.dictation])
  useEffect(() => setAskModel(settings.models.ask), [settings.models.ask])

  if (!preset) return null
  const setUp = isSetUp(settings, settings.hasKey)

  /** Runs `action` once the user agreed to send data to this provider (7.1); a local server skips it. */
  const withConsent = (action: () => void) => {
    if (hasConsent(settings)) action()
    else setConsentFor(() => action)
  }

  const loadModels = () => withConsent(async () => {
    setLoadingModels(true)
    setModelError(null)
    const result = await window.api.ai.listModels()
    setLoadingModels(false)
    if (result.success) setModels(result.data)
    else setModelError(result.error.message)
  })

  const test = () => withConsent(async () => {
    setTesting(true)
    const next: Record<string, ConnectionTestResult | string> = {}
    for (const model of [...new Set([dictationModel, askModel].map((m) => m.trim()).filter(Boolean))]) {
      const result = await window.api.ai.testConnection(model)
      next[model] = result.success ? result.data : result.error.message
    }
    setResults(next)
    setTesting(false)
    await qc.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY })
  })

  const dictationCaps = capabilitiesOf(settings, settings.models.dictation)
  const askCaps = capabilitiesOf(settings, settings.models.ask)
  const canDictate = !!dictationCaps?.structured
  const canAsk = !!askCaps?.structured && !!askCaps?.tools

  return (
    <section className={CARD} aria-labelledby="ai-models-heading">
      <h2 id="ai-models-heading" className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Models</h2>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={!setUp || loadingModels} onClick={loadModels}>
            {loadingModels ? 'Loading…' : 'Load models'}
          </Button>
          {models && <span className="text-xs text-[var(--text-secondary)]">{models.length} models</span>}
          {modelError && <span className="text-xs text-danger">{modelError} You can still type a model name.</span>}
        </div>
        <datalist id={listId}>{(models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="ai-model-dictation">Dictation model</label>
            <input
              id="ai-model-dictation"
              list={listId}
              value={dictationModel}
              placeholder={preset.suggested.dictation ?? 'Model name'}
              onChange={(e) => setDictationModel(e.target.value)}
              onBlur={() => { if (dictationModel !== settings.models.dictation) void save({ models: { dictation: dictationModel.trim() } }) }}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="ai-model-ask">Ask and Talk model</label>
            <input
              id="ai-model-ask"
              list={listId}
              value={askModel}
              placeholder={preset.suggested.ask ?? 'Model name'}
              onChange={(e) => setAskModel(e.target.value)}
              onBlur={() => { if (askModel !== settings.models.ask) void save({ models: { ask: askModel.trim() } }) }}
              className={INPUT}
            />
          </div>
        </div>

        <div>
          <Button variant="primary" disabled={!setUp || testing || (!dictationModel.trim() && !askModel.trim())} onClick={test}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {!setUp && <p className="mt-1 text-xs text-[var(--text-secondary)]">{preset.key === 'required' && !settings.hasKey ? 'Save a key first.' : 'Enter an address first.'}</p>}
          {Object.entries(results).map(([model, result]) => <TestResult key={model} model={model} result={result} />)}
        </div>

        <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
          <FeatureSwitch
            label="Smart dictation"
            hint={canDictate ? 'Speak or paste several tasks at once; check them on cards before they are added.' : 'Needs a dictation model that passed Test connection.'}
            checked={settings.features.dictation && canDictate}
            disabled={!canDictate}
            onChange={(on) => void save({ features: { dictation: on } })}
          />
          <FeatureSwitch
            label="Ask"
            hint={canAsk ? 'Chat with your tasks (Mod+J). Changes are proposed on cards you apply.' : 'Needs a model that gave a structured answer and called the test tool.'}
            checked={settings.features.ask && canAsk}
            disabled={!canAsk}
            onChange={(on) => void save({ features: { ask: on } })}
          />
          <FeatureSwitch
            label="Talk"
            hint="Ask by voice: hold to talk in Ask; answers are read aloud with the system voice."
            checked={settings.features.talk && settings.features.ask && canAsk}
            disabled={!canAsk || !settings.features.ask}
            onChange={(on) => void save({ features: { talk: on } })}
          />
        </div>
      </div>

      <ConsentDialog
        open={consentFor !== null}
        providerName={preset.name}
        onCancel={() => setConsentFor(null)}
        onAgree={async () => {
          const action = consentFor
          setConsentFor(null)
          await save({ consented: [...new Set([...settings.consented, consentKey(settings)])] })
          action?.()
        }}
      />
    </section>
  )
}

function FeatureSwitch({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className={cn('block text-sm', disabled ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>{label}</span>
        <span className="block text-xs text-[var(--text-secondary)]">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

function TestResult({ model, result }: { model: string; result: ConnectionTestResult | string }) {
  if (typeof result === 'string') return <p className="mt-2 text-xs text-danger">{model}: {result}</p>
  const row = (ok: boolean, text: string) => (
    <li className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-status-done" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />}
      <span className="sr-only">{ok ? 'Passed:' : 'Failed:'}</span>
      {text}
    </li>
  )
  const features = [result.features.dictation && 'Dictation', result.features.ask && 'Ask', result.features.talk && 'Talk'].filter(Boolean)
  return (
    <div className="mt-2 rounded-control border border-[var(--border-color)] p-3 text-xs text-[var(--text-primary)]">
      <p className="mb-1 font-medium">{model}</p>
      <ul className="space-y-0.5">
        {row(result.models.ok, result.models.ok ? `Model list (${result.models.count})` : `Model list: ${result.models.error ?? 'not available'}`)}
        {row(result.structured.ok, result.structured.ok ? `Structured answer (${result.structured.mode === 'prompt' ? 'from the prompt' : 'strict schema'})` : `Structured answer: ${result.structured.error ?? 'failed'}`)}
        {row(result.tool.ok, result.tool.ok ? 'Tool call' : `Tool call: ${result.tool.error ?? 'failed'}`)}
      </ul>
      <p className="mt-1 text-[var(--text-secondary)]">{features.length ? `Can run: ${features.join(', ')}` : 'This model can run none of the features.'}</p>
    </div>
  )
}

/** What each feature sends (7.1), asked before a cloud provider is first used. */
function ConsentDialog({ open, providerName, onAgree, onCancel }: { open: boolean; providerName: string; onAgree: () => void; onCancel: () => void }) {
  const titleId = useId()
  return (
    <Dialog open={open} onClose={onCancel} labelledBy={titleId} className="w-[480px] max-w-[92vw]">
      <div className="space-y-3 p-5 text-sm text-[var(--text-primary)]">
        <h2 id={titleId} className="text-card-title">Send data to {providerName}?</h2>
        <p className="text-xs text-[var(--text-secondary)]">The assistant sends this to {providerName} with your key, and only when you use it:</p>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li><strong>Dictation</strong>: the text of what you said or pasted (never audio), your project, label and place names, the list you are in, and the date, time and time zone.</li>
          <li><strong>Ask and Talk</strong>: your messages, an overview (counts, project, label and custom list names), and the tasks it looks up, including the names of people in shared projects.</li>
        </ul>
        <p className="text-xs text-[var(--text-secondary)]">
          Never sent: audio (speech is recognised on this computer), hidden tasks, comment texts, attachments, your Vikunja token, your server address, place positions.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="quiet" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" data-autofocus="" onClick={onAgree}>Agree</Button>
        </div>
      </div>
    </Dialog>
  )
}

function SpeechCard({ settings }: { settings: AiSettingsView }) {
  const { data: status } = useSpeechStatus()
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const [progress, setProgress] = useState<Record<string, SpeechDownloadProgress>>({})
  useEffect(() => window.api.speech.onDownloadProgress((p) => {
    setProgress((current) => ({ ...current, [p.id]: p }))
    if (p.done || p.error) void qc.invalidateQueries({ queryKey: SPEECH_STATUS_QUERY_KEY })
  }), [qc])
  const states = useMemo(() => new Map((status?.models ?? []).map((m) => [m.id, m])), [status])

  const refresh = () => qc.invalidateQueries({ queryKey: SPEECH_STATUS_QUERY_KEY })

  return (
    <section className={CARD} aria-labelledby="ai-speech-heading">
      <h2 id="ai-speech-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Speech on this computer</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        With a speech model downloaded, voice input, dictation and Talk turn speech into text on this computer; audio never leaves it. Without one, the system recogniser is used{window.api.platform === 'linux' ? ' (Linux has none)' : ''}.
      </p>
      {status && !status.engine && (
        <p className="mb-3 text-xs text-danger">Local speech is not part of this build of Vicu.</p>
      )}
      <ul className="space-y-2">
        {SPEECH.models.map((model) => {
          const state = states.get(model.id)
          const live = progress[model.id]
          const downloading = state?.downloading || (live && !live.done && !live.error)
          const bytes = live?.downloadedBytes ?? state?.downloadedBytes ?? 0
          const active = status?.activeModelId === model.id
          return (
            <li key={model.id} className="flex items-center gap-3 rounded-control border border-[var(--border-color)] px-3 py-2">
              <input
                type="radio"
                name="speech-model"
                aria-label={`Use ${model.label}`}
                checked={settings.speech.modelId === model.id}
                disabled={!state?.downloaded}
                onChange={() => void save({ speech: { modelId: model.id } }).then(refresh)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text-primary)]">
                  {model.label}
                  {model.default_for.includes('computer') && <span className="ml-2 text-xs text-accent-blue">Suggested</span>}
                  {active && <span className="ml-2 text-xs text-status-done">In use</span>}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {formatBytes(model.size)} · {model.language_codes ? `${model.language_count} European languages` : `${model.language_count} languages`} · {model.license}
                  {model.attribution && <> · {model.attribution}</>}
                </p>
                {downloading && <p className="text-xs text-[var(--text-secondary)]" role="status">Downloading {Math.round((bytes / model.size) * 100)}%</p>}
                {!downloading && !state?.downloaded && bytes > 0 && <p className="text-xs text-[var(--text-secondary)]">Paused at {Math.round((bytes / model.size) * 100)}%</p>}
                {(live?.error && live.error !== 'Paused.' ? live.error : state?.error) && <p className="text-xs text-danger">{live?.error ?? state?.error}</p>}
              </div>
              {state?.downloaded ? (
                <Button variant="quiet" danger aria-label={`Delete ${model.label}`} onClick={() => void window.api.speech.deleteModel(model.id).then(refresh).then(() => qc.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY }))}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                </Button>
              ) : downloading ? (
                <Button variant="secondary" onClick={() => void window.api.speech.cancelDownload(model.id).then(refresh)}>
                  <Pause className="h-4 w-4" aria-hidden="true" /> Pause
                </Button>
              ) : (
                <Button variant="secondary" disabled={status ? !status.engine : true} onClick={() => {
                  setProgress((current) => ({ ...current, [model.id]: { id: model.id, downloadedBytes: bytes, totalBytes: model.size, done: false } }))
                  void window.api.speech.download(model.id).then(refresh)
                }}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" aria-hidden="true" />} {bytes > 0 ? 'Resume' : 'Download'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-3">
        <label className={LABEL} htmlFor="speech-language">Language</label>
        <select
          id="speech-language"
          value={settings.speech.language}
          onChange={(e) => void save({ speech: { language: e.target.value } })}
          className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
        >
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">Parakeet models detect the language themselves.</p>
      </div>
    </section>
  )
}

function PrivacyCard() {
  const clear = async () => {
    await window.api.ai.saveConversations([])
    useAskStore.setState({ conversations: [], currentId: null })
    toast.success('Conversations deleted')
  }
  return (
    <section className={CARD} aria-labelledby="ai-privacy-heading">
      <h2 id="ai-privacy-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Privacy</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Conversations (the last five) and transcripts kept after a failed request stay on this computer and are deleted when you sign out. The assistant’s settings and key stay with this computer.
      </p>
      <Button variant="secondary" danger onClick={() => void clear()}>Delete conversations</Button>
    </section>
  )
}

