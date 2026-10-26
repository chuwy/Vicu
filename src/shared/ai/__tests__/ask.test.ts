import { describe, expect, it } from 'vitest'
import { answerParts, askContextJson, askRefreshJson, isStaleConversation, lastActivity, needsContextRefresh, requestWindow, spokenText } from '../ask'
import { AI_LIMITS } from '../contract'
import type { ChatMessage } from '../types'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 5.1.
describe('Ask context', () => {
  it('writes now, weekday, zone, week start, list, the list id and the overview', () => {
    expect(askContextJson('2026-10-06T10:00:30', 'Europe/Amsterdam', { name: 'Work', projectId: 12 }, { counts: { inbox: 1 } })).toBe(
      '{"now":"2026-10-06T10:00","weekday":"Tuesday","time_zone":"Europe/Amsterdam","week_starts":"monday","list":"Work","list_project_id":12,"overview":{"counts":{"inbox":1}}}',
    )
    expect(JSON.parse(askContextJson('2026-10-06T10:00', 'UTC', { name: 'Soon', customListId: 'abc' }, {})).list_custom_list_id).toBe('abc')
    expect(Object.keys(JSON.parse(askContextJson('2026-10-06T10:00', 'UTC', { name: 'Today' }, {})))).toEqual(['now', 'weekday', 'time_zone', 'week_starts', 'list', 'overview'])
  })

  it('refreshes after 30 minutes or on another day, with now and weekday only', () => {
    expect(needsContextRefresh('2026-10-06T10:00:00', '2026-10-06T10:30:00')).toBe(false)
    expect(needsContextRefresh('2026-10-06T10:00:00', '2026-10-06T10:31:00')).toBe(true)
    expect(needsContextRefresh('2026-10-06T23:59:00', '2026-10-07T00:01:00')).toBe(true)
    expect(askRefreshJson('2026-10-07T00:01:12')).toBe('{"now":"2026-10-07T00:01","weekday":"Wednesday"}')
  })
})

describe('a conversation left idle', () => {
  const minutes = aiFixture.limits.context_refresh_minutes as number
  const at = (ms: number) => ({ at: ms, message: { role: 'user', text: 'hi' } as ChatMessage })

  it('is counted from its last message, else from its last change', () => {
    expect(lastActivity({ updatedAt: 9_000, messages: [at(1_000), at(5_000)] })).toBe(5_000)
    expect(lastActivity({ updatedAt: 9_000, messages: [] })).toBe(9_000)
  })

  it('makes Ask start a new conversation after context_refresh_minutes', () => {
    expect(AI_LIMITS.context_refresh_minutes).toBe(minutes)
    const conversation = { updatedAt: 0, messages: [at(1_000)] }
    expect(isStaleConversation(conversation, 1_000 + minutes * 60_000)).toBe(false)
    expect(isStaleConversation(conversation, 1_000 + minutes * 60_000 + 1)).toBe(true)
  })
})

describe('request window', () => {
  const user = (text: string): ChatMessage => ({ role: 'user', text })
  const call = (id: string): ChatMessage => ({ role: 'assistant', text: '', toolCalls: [{ id, name: 'get_overview', arguments: '{}' }] })
  const result = (id: string): ChatMessage => ({ role: 'tool', results: [{ callId: id, name: 'get_overview', content: '{}' }] })

  it('sends at most the last 40 messages, starting with a user message', () => {
    const messages: ChatMessage[] = []
    for (let i = 0; i < 15; i++) messages.push(user(`q${i}`), call(`c${i}`), result(`c${i}`))
    const window = requestWindow(messages)
    expect(window.length).toBeLessThanOrEqual(40)
    expect(window[0].role).toBe('user')
    // Never a tool result without its call.
    for (let i = 0; i < window.length; i++) {
      if (window[i].role === 'tool') expect(window[i - 1]?.role).toBe('assistant')
    }
  })
})

describe('task marks', () => {
  it('renders known ids as rows and others as nothing', () => {
    expect(answerParts('Two things:\n[task:5]\n[task:9]\nDone.', new Set([5]))).toEqual([
      { text: 'Two things:\n' },
      { taskId: 5 },
      { text: '\nDone.' },
    ])
  })

  it('speaks without marks or emphasis', () => {
    expect(spokenText('**Groceries** is due [task:5] today.')).toBe('Groceries is due today.')
  })
})
