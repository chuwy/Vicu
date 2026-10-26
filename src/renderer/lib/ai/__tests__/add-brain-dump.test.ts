import { describe, expect, it } from 'vitest'
import { addBrainDump, addedMessage, creationOrder, undoBrainDump, type AddBrainDumpDeps } from '../add-brain-dump'
import type { BrainDumpDraft, CheckedProject } from '../../../../shared/ai/brain-dump'
import type { CheckedDraft } from '../../../../shared/ai/dictation'
import type { Project } from '../../vikunja-types'
import { project as makeProject, task as makeTask } from './helpers'

// docs/ai-assistant-v1.md section 4.8.5: the projects first (parents before subprojects), then the
// tasks with the new ids; a project that fails stops Add before any task and the projects made are
// deleted again; Undo deletes the tasks, then the projects.

const planProject = (ref: string, title: string, extra: Partial<CheckedProject> = {}): CheckedProject => ({
  ref, title, parent_id: null, parent_ref: null, ...extra,
})

const draft = (ref: string, extra: Partial<BrainDumpDraft> = {}): BrainDumpDraft => ({
  ref, title: `Task ${ref}`, notes: '', due: null, project_id: 12, project_ref: null, labels: [], priority: null,
  repeat: null, reminder: null, place: null, subtasks: [], guessed: [], ...extra,
})

function fakeDeps(options: { failProject?: string; failTasks?: boolean } = {}) {
  const log: string[] = []
  const added: CheckedDraft[][] = []
  let nextId = 100
  const deps: AddBrainDumpDeps = {
    createProject: async (title, parentId) => {
      log.push(`create ${title} under ${parentId ?? 'top'}`)
      if (title === options.failProject) throw new Error('HTTP 500')
      return makeProject(nextId++, title, { parent_project_id: parentId ?? 0 })
    },
    deleteProject: async (id) => { log.push(`delete project ${id}`) },
    addDrafts: async (drafts) => {
      added.push([...drafts])
      log.push(`add ${drafts.length} tasks`)
      if (options.failTasks) throw new Error('HTTP 403')
      const tasks = drafts.map((d, i) => makeTask(200 + i, d.title, { project_id: d.project_id }))
      return { created: tasks, tasks, problems: [] }
    },
    defaultProjectId: 1,
  }
  return { deps, log, added }
}

const plan = [
  planProject('p1', 'Garden', { parent_id: 12 }),
  planProject('p2', 'Vegetable patch', { parent_ref: 'p1' }),
  planProject('p3', 'Side business'),
]
const drafts = [
  draft('d1', { project_id: null, project_ref: 'p2' }),
  draft('d2', { project_id: 15 }),
  draft('d3', { project_id: null, project_ref: 'p3' }),
]

describe('adding a brain dump', () => {
  it('creates the projects in order under their parents, then the tasks in them', async () => {
    const { deps, log, added } = fakeDeps()
    const outcome = await addBrainDump(plan, drafts, deps)
    expect(log).toEqual(['create Garden under 12', 'create Vegetable patch under 100', 'create Side business under top', 'add 3 tasks'])
    expect(added[0].map((d) => d.project_id)).toEqual([101, 15, 102])
    expect(added[0].every((d) => !('project_ref' in d))).toBe(true)
    expect(outcome.ok && outcome.projects.map((p) => p.id)).toEqual([100, 101, 102])
  })

  it('puts a parent first even when the plan lists it later', () => {
    const order = creationOrder([planProject('p2', 'Child', { parent_ref: 'p1' }), planProject('p1', 'Parent'), planProject('p3', 'Other')])
    expect(order.map((p) => p.ref)).toEqual(['p1', 'p2', 'p3'])
  })

  it('stops before any task when a project fails, and deletes the projects it made', async () => {
    const { deps, log } = fakeDeps({ failProject: 'Side business' })
    const outcome = await addBrainDump(plan, drafts, deps)
    expect(log).toEqual([
      'create Garden under 12',
      'create Vegetable patch under 100',
      'create Side business under top',
      'delete project 101',
      'delete project 100',
    ])
    expect(outcome).toMatchObject({ ok: false, stage: 'projects', project: { ref: 'p3' } })
  })

  it('reports the new projects by ref when a task cannot be made', async () => {
    const { deps } = fakeDeps({ failTasks: true })
    const outcome = await addBrainDump(plan, drafts, deps)
    expect(outcome).toMatchObject({ ok: false, stage: 'tasks', projectIds: { p1: 100, p2: 101, p3: 102 } })
  })

  it('adds the tasks alone when the plan has no new projects', async () => {
    const { deps, log } = fakeDeps()
    const outcome = await addBrainDump([], [draft('d1'), draft('d2', { project_id: 15 })], deps)
    expect(log).toEqual(['add 2 tasks'])
    expect(outcome.ok && outcome.projects).toEqual([])
  })

  it('undoes the tasks first, then the projects, each newest first', async () => {
    const log: string[] = []
    const projects: Project[] = [makeProject(100, 'Garden'), makeProject(101, 'Vegetable patch')]
    await undoBrainDump({ created: [makeTask(200, 'a'), makeTask(201, 'b')] }, projects, {
      deleteTask: async (task) => { log.push(`task ${task.id}`) },
      deleteProject: async (id) => {
        log.push(`project ${id}`)
        if (id === 101) throw new Error('gone')
      },
    })
    expect(log).toEqual(['task 201', 'task 200', 'project 101', 'project 100'])
  })

  it('says what was added, in the singular for one', () => {
    expect(addedMessage(2, 14)).toBe('Added 2 projects and 14 tasks')
    expect(addedMessage(1, 1)).toBe('Added 1 project and 1 task')
    expect(addedMessage(0, 3)).toBe('Added 3 tasks')
    expect(addedMessage(2, 0)).toBe('Added 2 projects')
  })
})
