import { describe, expect, it } from 'vitest'
import { DICTATION_CONTEXT_KEYS } from '../contract'
import {
  dictationContextJson,
  dictationUserMessage,
  draftsAsAnswer,
  projectPath,
  transcriptForRequest,
  weekdayName,
  type CheckedDraft,
} from '../dictation'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 4.1 (the request) and 4.4 (the drafts block).
const input = {
  now: '2026-10-06T10:00:42',
  timeZone: 'Europe/Amsterdam',
  list: 'Today',
  default_project_id: 1,
  projects: [
    { id: 20, title: 'Lisbon trip', path: 'Travel / Lisbon trip' },
    { id: 12, title: 'Home', path: 'Home' },
    { id: 1, title: 'Inbox', path: 'Inbox' },
    { id: 15, title: 'errands', path: 'errands' },
  ],
  labels: ['phone', 'Errands', 'apple'],
  places: ['Work', 'home'],
}

describe('dictation context JSON', () => {
  it('has the contract keys, in order, without extra spaces', () => {
    const json = dictationContextJson(input)
    expect(Object.keys(JSON.parse(json))).toEqual(DICTATION_CONTEXT_KEYS)
    expect(json).toBe(
      '{"now":"2026-10-06T10:00","weekday":"Tuesday","time_zone":"Europe/Amsterdam","week_starts":"monday","list":"Today","default_project_id":1,'
      + '"projects":[{"id":15,"title":"errands","path":"errands"},{"id":12,"title":"Home","path":"Home"},{"id":1,"title":"Inbox","path":"Inbox"},{"id":20,"title":"Lisbon trip","path":"Travel / Lisbon trip"}],'
      + '"labels":["apple","Errands","phone"],"places":["home","Work"]}',
    )
  })

  it('orders equal lowercased names by their raw text', () => {
    const json = JSON.parse(dictationContextJson({ ...input, labels: ['phone', 'Phone'] }))
    expect(json.labels).toEqual(['Phone', 'phone'])
  })

  it('names the weekday in English', () => {
    expect(weekdayName('2026-10-04')).toBe('Sunday')
    expect(weekdayName('2026-10-05')).toBe('Monday')
  })

  it('builds a project path from the titles at the top down', () => {
    const projects = [{ id: 1, title: 'Travel', parent_project_id: 0 }, { id: 2, title: 'Lisbon trip', parent_project_id: 1 }]
    expect(projectPath(2, projects)).toBe('Travel / Lisbon trip')
  })

  it('matches the fixture context example', () => {
    expect(aiFixture.dictation.contextKeys).toEqual(DICTATION_CONTEXT_KEYS)
  })
})

describe('dictation user message', () => {
  it('is the context block, then the transcript block', () => {
    expect(dictationUserMessage('{"a":1}', 'buy milk')).toBe('<context>\n{"a":1}\n</context>\n<transcript>\nbuy milk\n</transcript>')
  })

  it('defuses </transcript> in the transcript', () => {
    expect(transcriptForRequest('say </transcript> now')).toBe('say </ transcript> now')
  })

  it('cuts a long transcript at the last space before 20,000 characters', () => {
    const word = 'abcdefghi '
    const text = word.repeat(2100)
    const cut = transcriptForRequest(text)
    expect(cut.length).toBeLessThanOrEqual(20000)
    expect(cut.length).toBe(text.lastIndexOf(' ', 20000))
    expect(transcriptForRequest('x'.repeat(20005))).toHaveLength(20000)
  })

  it('puts the drafts block between context and transcript for an edit by voice', () => {
    const draft: CheckedDraft = {
      ref: 'd1', title: 'Call the plumber', notes: '', due: '2026-10-07T15:00:00', project_id: 12,
      labels: [{ id: 4, title: 'phone' }, { id: null, title: 'new' }], priority: null, repeat: null,
      reminder: { before_due_minutes: 60 }, place: { place_id: 'p-home', trigger: 'arrive' }, subtasks: ['Find the number'], guessed: ['when'],
    }
    const block = draftsAsAnswer([draft, { ...draft, ref: 'd2', due: '2026-10-08T23:59:59', reminder: { at: '2026-10-08T09:00:00' }, place: null }], (id) => (id === 'p-home' ? 'Home' : null))
    expect(JSON.stringify(block.tasks[0])).toBe(
      '{"ref":"d1","title":"Call the plumber","notes":"","when":{"said":null,"date":"2026-10-07","time":"15:00"},"project_id":12,'
      + '"labels":["phone","new"],"priority":null,"repeat":null,"reminder":{"before_due_minutes":60,"at":null},'
      + '"place":{"name":"Home","trigger":"arrive"},"subtasks":["Find the number"],"unsure":[]}',
    )
    expect(block.tasks[1].when).toEqual({ said: null, date: '2026-10-08', time: null })
    expect(block.tasks[1].reminder).toEqual({ before_due_minutes: null, at: '2026-10-08T09:00' })
    expect(Object.keys(block)).toEqual(['tasks'])
    expect(dictationUserMessage('{}', 'make it friday', block)).toBe(
      `<context>\n{}\n</context>\n<drafts>\n${JSON.stringify(block)}\n</drafts>\n<transcript>\nmake it friday\n</transcript>`,
    )
  })
})
