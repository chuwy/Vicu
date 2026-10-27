import { describe, expect, it } from 'vitest'
import { dateOnlyDue } from '../../due-dates'
import { checkOrganize, organizeRequestUser } from '../organize-request'
import { task, workspace } from './helpers'

// docs/ai-assistant-v1.md section 9.1: the request from the window's workspace.
describe('organize request from the workspace', () => {
  const ws = workspace()
  const input = {
    session: 'inbox' as const,
    listName: 'Inbox',
    defaultProjectId: 1,
    reference: '2026-10-06T10:00:00',
    tasks: [
      task(101, 'dentist', { project_id: 1, created: new Date(2026, 9, 1, 9).toISOString(), updated: new Date(2026, 9, 2, 9).toISOString(), description: '<p>Call <b>first</b></p>' }),
      task(102, 'milk', { project_id: 1, due_date: dateOnlyDue('2026-10-05') }),
    ],
  }

  it('sends the context, the session and the task entries', () => {
    const user = organizeRequestUser(ws, input)
    const [, context, rest] = /^<context>\n(.*)\n<\/context>\n([\s\S]*)$/.exec(user) ?? []
    expect(JSON.parse(context)).toMatchObject({ now: '2026-10-06T10:00', list: 'Inbox', default_project_id: 1 })
    expect(rest.startsWith('<session>\ninbox\n</session>\n<tasks>\n')).toBe(true)
    const tasks = JSON.parse(rest.replace(/^<session>\ninbox\n<\/session>\n<tasks>\n/, '').replace(/\n<\/tasks>$/, ''))
    expect(tasks[0]).toMatchObject({ id: 101, title: 'dentist', project: 'Inbox', created: '2026-10-01', changed: '2026-10-02', notes: 'Call first' })
    expect(Object.keys(tasks[0]).slice(-3)).toEqual(['created', 'changed', 'notes'])
    expect(tasks[1]).toMatchObject({ id: 102, due: '2026-10-05', created: null, changed: null, notes: '' })
  })

  it('checks an answer against the batch and the writable projects', () => {
    const result = checkOrganize(ws, input, {
      suggestions: [
        { task_id: 101, title: null, project_id: 12, when: { said: 'friday', date: null, time: null }, clear_due: false, close: null, reason: 'Home' },
        { task_id: 102, title: null, project_id: 40, when: { said: null, date: null, time: null }, clear_due: true, close: 'done', reason: 'Bought' },
      ],
      next_step: null,
    }, 'en-US')
    expect(result.suggestions[0]).toMatchObject({ task_id: 101, project_id: 12, due: '2026-10-09T23:59:59' })
    // 40 is a read-only project: not offered to the model, so dropped.
    expect(result.suggestions[1]).toMatchObject({ task_id: 102, project_id: null, clear_due: true, close: 'done' })
    expect(result.dropped).toEqual([{ task_id: 102, field: 'project', value: 40 }])
  })
})
