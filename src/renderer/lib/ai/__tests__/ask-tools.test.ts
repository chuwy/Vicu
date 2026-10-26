import { describe, expect, it } from 'vitest'
import { findTasks, getOverview, getTask, listView, repeatText, type ToolContext } from '../ask-tools'
import { summariseTask, notesPlainText } from '../task-summary'
import { task, workspace } from './helpers'

// docs/ai-assistant-v1.md sections 5.2 and 5.3.
const now = new Date(2026, 9, 6, 10, 0, 0)
const at = (d: number, h = 23, m = 59, s = 59) => new Date(2026, 9, d, h, m, s).toISOString()
const all = [
  task(1, 'Pay rent', { project_id: 1, due_date: at(5), priority: 3 }),
  task(2, 'Call the plumber', { project_id: 12, due_date: at(6, 15, 0, 0) }),
  task(3, 'Buy milk', { project_id: 12, due_date: at(9), description: '<p>Oat milk &amp; eggs</p>' }),
  task(4, 'Plan the trip', { project_id: 20, due_date: at(20) }),
  task(5, 'Old task', { project_id: 30 }),
  task(6, 'Routine carrier', { project_id: 12, description: '<!-- vicu-routine:v1:xyz -->' }),
  task(7, 'Shared work', { project_id: 50, created_by: { id: 9, username: 'maya', name: 'Maya' }, assignees: [{ id: 9, username: 'maya', name: 'Maya' }, { id: 1, username: 'me' }], comment_count: 2, is_unread: true }),
  task(8, 'Inbox thing', { project_id: 1 }),
]
const ctx: ToolContext = {
  ws: workspace(),
  now: () => now,
  fetchTasks: async (params) => (String(params.filter ?? '').includes('done = true') ? [] : all.filter((t) => !t.done)),
  fetchTask: async (id) => all.find((t) => t.id === id) ?? null,
  syncedValues: {},
  review: { enabled: false, defaultCadenceDays: 14, excludeInbox: false },
}

describe('task summary', () => {
  it('has the fixture fields, in order, and the shared fields only in shared projects', () => {
    const own = summariseTask(all[1], ctx.ws)
    expect(Object.keys(own)).toEqual(['id', 'title', 'done', 'due', 'project_id', 'project', 'labels', 'priority', 'repeats', 'has_notes', 'subtask_count', 'shared'])
    expect(own.due).toBe('2026-10-06T15:00')
    expect(summariseTask(all[2], ctx.ws)).toMatchObject({ due: '2026-10-09', has_notes: true })
    expect(summariseTask(all[3], ctx.ws).project).toBe('Travel / Lisbon trip')
    expect(summariseTask(all[6], ctx.ws)).toMatchObject({ shared: true, by: 'Maya', assignees: ['You', 'Maya'], comment_count: 2, unread: true })
  })

  it('reads notes as plain text', () => {
    expect(notesPlainText('<p>One &amp; two</p>\n<ul><li><p>three</p></li></ul>')).toBe('One & two\nthree')
  })
})

describe('read tools', () => {
  it('get_overview counts open tasks of active projects and leaves hidden tasks out', async () => {
    const overview = await getOverview(ctx) as { counts: Record<string, number>; projects: Array<{ id: number; path: string }> }
    expect(overview.counts).toEqual({ inbox: 2, today: 1, overdue: 1, upcoming: 2, anytime: 4 })
    expect(overview.projects.map((p) => p.path)).toEqual(['Home', 'Inbox', 'Shared view', 'Team', 'Travel', 'Travel / Lisbon trip'])
  })

  it('find_tasks uses the custom-list windows and text, sorted by the default order', async () => {
    const week = await findTasks({ text: null, project_ids: null, label_ids: null, due: 'this_week', include_overdue: false, due_from: null, due_to: null, priority_min: null, status: null, assigned: null, limit: null }, ctx)
    expect(week.tasks.map((t) => t.id)).toEqual([2, 3])
    const withOverdue = await findTasks({ due: 'this_week', include_overdue: null }, ctx)
    expect(withOverdue.tasks.map((t) => t.id)).toEqual([1, 2, 3])
    const text = await findTasks({ text: 'OAT eggs' }, ctx)
    expect(text.tasks.map((t) => t.id)).toEqual([3])
    const limited = await findTasks({ limit: 2 }, ctx)
    expect(limited.tasks).toHaveLength(2)
    expect(limited.more).toBe(4)
    const archived = await findTasks({ project_ids: [30] }, ctx)
    expect(archived.tasks.map((t) => t.id)).toEqual([5])
    const mine = await findTasks({ assigned: 'me' }, ctx)
    expect(mine.tasks.map((t) => t.id)).toEqual([7])
  })

  it('list_view gives a list in its order, in pages', async () => {
    expect((await listView({ view: 'today', project_id: null, custom_list_id: null, page: null }, ctx)).tasks.map((t) => t.id)).toEqual([1, 2])
    expect((await listView({ view: 'inbox', page: 1 }, ctx)).tasks.map((t) => t.id)).toEqual([1, 8])
    await expect(listView({ view: 'project', project_id: 999 }, ctx)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('get_task gives notes, reminders and repeat; hidden tasks are not found', async () => {
    const result = await getTask({ task_id: 3 }, ctx) as { notes: string }
    expect(result.notes).toBe('Oat milk & eggs')
    await expect(getTask({ task_id: 6 }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    expect(repeatText({ repeat_after: 1209600, repeat_mode: 0 })).toBe('every 2 weeks')
    expect(repeatText({ repeat_after: 0, repeat_mode: 1 })).toBe('every month')
  })
})
