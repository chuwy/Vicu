import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS, canRunFeature, featureNeeds, featureProblem, modelKey, modelsInUse, normaliseAiSettings, untestedModels } from '../settings'
import type { AiSettings, ConnectionTestResult } from '../types'

// Settings, Assistant tests a model by itself (docs/ai-assistant.md): which models still need the
// test, and what a failed test says per feature.

const ollama = (models: AiSettings['models'], tested: AiSettings['tested'] = {}): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  provider: 'ollama',
  address: 'http://localhost:11434/v1',
  models,
  tested,
})

const result = (structured: boolean, tool: boolean, errors: { structured?: string; tool?: string } = {}): ConnectionTestResult => ({
  models: { ok: true, count: 3 },
  structured: { ok: structured, mode: structured ? 'json_schema' : null, ...(errors.structured ? { error: errors.structured } : {}) },
  tool: { ok: tool, ...(errors.tool ? { error: errors.tool } : {}) },
  features: { dictation: structured, ask: structured && tool, talk: structured && tool },
})

describe('models to test by themselves', () => {
  it('lists each model in use once', () => {
    expect(modelsInUse(ollama({ dictation: 'a', ask: 'a' }))).toEqual(['a'])
    expect(modelsInUse(ollama({ dictation: 'a', ask: ' b ' }))).toEqual(['a', 'b'])
    expect(modelsInUse(ollama({ dictation: '', ask: '' }))).toEqual([])
  })

  it('tests only models without a result, and only once requests can go out', () => {
    const settings = ollama({ dictation: 'a', ask: 'b' })
    expect(untestedModels(settings, false)).toEqual(['a', 'b'])
    const tested = ollama({ dictation: 'a', ask: 'b' }, { [modelKey(settings, 'a')]: { structured: 'json_schema', tools: false } })
    expect(untestedModels(tested, false)).toEqual(['b'])
    // OpenAI needs a key first; Ollama needs none.
    const openai: AiSettings = { ...DEFAULT_AI_SETTINGS, provider: 'openai', models: { dictation: 'm', ask: 'm' } }
    expect(untestedModels(openai, false)).toEqual([])
    expect(untestedModels(openai, true)).toEqual(['m'])
    expect(untestedModels({ ...DEFAULT_AI_SETTINGS, models: { dictation: 'm', ask: 'm' } }, true)).toEqual([])
  })
})

describe('what a test says per feature', () => {
  it('needs a structured answer for dictation, and a tool call too for Ask', () => {
    expect(canRunFeature('dictation', { structured: 'prompt', tools: false })).toBe(true)
    expect(canRunFeature('ask', { structured: 'prompt', tools: false })).toBe(false)
    expect(canRunFeature('ask', { structured: 'json_schema', tools: true })).toBe(true)
    expect(canRunFeature('dictation', { structured: null, tools: true })).toBe(false)
    expect(canRunFeature('dictation', undefined)).toBe(false)
  })

  it('passes: no problem', () => {
    expect(featureProblem('dictation', result(true, false))).toBeNull()
    expect(featureProblem('ask', result(true, true))).toBeNull()
  })

  it('shows the test’s own first problem', () => {
    expect(featureProblem('ask', 'The provider refused the key.')).toBe('The provider refused the key.')
    expect(featureProblem('ask', result(false, false, { structured: 'Not JSON.', tool: 'No call.' }))).toBe('Not JSON.')
    expect(featureProblem('ask', result(true, false, { tool: 'The model did not call the tool.' }))).toBe('The model did not call the tool.')
    expect(featureProblem('dictation', result(false, true, { structured: 'Not JSON.' }))).toBe('Not JSON.')
  })

  it('else says plainly what the feature needs', () => {
    expect(featureProblem('dictation', result(false, false))).toBe(featureNeeds('dictation'))
    expect(featureProblem('ask', result(true, false))).toBe('Ask needs a model that can call tools. Choose another model.')
    expect(featureProblem('ask', result(false, false))).toBe('Ask needs a model that can give a structured answer. Choose another model.')
    expect(featureNeeds('dictation')).toBe('Smart dictation needs a model that can give a structured answer. Choose another model.')
  })
})

describe('the Brain dump switch (4.8)', () => {
  it('is off by default and kept only as a real true', () => {
    expect(DEFAULT_AI_SETTINGS.brainDump).toBe(false)
    expect(normaliseAiSettings({}).brainDump).toBe(false)
    expect(normaliseAiSettings({ brainDump: 'yes' }).brainDump).toBe(false)
    expect(normaliseAiSettings({ ...DEFAULT_AI_SETTINGS, brainDump: true }).brainDump).toBe(true)
  })
})
