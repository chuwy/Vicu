import { describe, expect, it } from 'vitest'
import {
  appendToDump,
  brainDumpUserMessage,
  changedProjects,
  checkBrainDumpAnswer,
  planAsAnswer,
  planGroups,
  planProjectPath,
  removePlanProject,
  type BrainDumpAnswer,
  type BrainDumpDraft,
  type BrainDumpTaskAnswer,
  type CheckedProject,
} from '../brain-dump'
import type { CheckContext } from '../dictation'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 4.8: the request and its plan block (4.8.1, 4.8.4), the dump's
// limit (4.8), checks the vectors do not cover (4.8.3), and the plan's review rules (4.8.5). The
// `brainDump.checks` vectors run with the real parser in src/renderer/lib/ai/__tests__.

const draft = (ref: string, extra: Partial<BrainDumpDraft> = {}): BrainDumpDraft => ({
  ref, title: `Task ${ref}`, notes: '', due: null, project_id: 12, project_ref: null, labels: [], priority: null,
  repeat: null, reminder: null, place: null, subtasks: [], guessed: [], ...extra,
})

const project = (ref: string, title: string, extra: Partial<CheckedProject> = {}): CheckedProject => ({
  ref, title, parent_id: null, parent_ref: null, ...extra,
})

const task = (ref: string, extra: Partial<BrainDumpTaskAnswer> = {}): BrainDumpTaskAnswer => ({
  ref, title: `Task ${ref}`, notes: '', when: { said: null, date: null, time: null }, project_id: null, project_ref: null,
  labels: [], priority: null, repeat: null, reminder: null, place: null, subtasks: [], unsure: [], ...extra,
})

const context: CheckContext = {
  reference: '2026-10-06T10:00:00',
  defaultDue: '2026-10-06',
  ...aiFixture.dictation.context,
  readSaid: () => null,
}

describe('brain dump request', () => {
  it('is the context block, then the transcript block, for Organize', () => {
    expect(brainDumpUserMessage('{"a":1}', 'all my thoughts')).toBe('<context>\n{"a":1}\n</context>\n<transcript>\nall my thoughts\n</transcript>')
  })

  it('puts the plan between context and transcript for an Update, in the answer shape', () => {
    const projects = [project('p1', 'Garden', { parent_id: 12 }), project('p2', 'Vegetable patch', { parent_ref: 'p1' })]
    const drafts = [
      draft('d1', { project_id: null, project_ref: 'p2', due: '2026-10-07T15:00:00', labels: [{ id: 3, title: 'errands' }, { id: null, title: 'new' }], guessed: ['when'] }),
      draft('d2', { due: '2026-10-08T23:59:59', place: { place_id: 'p-home', trigger: 'arrive' } }),
    ]
    const plan = planAsAnswer(projects, drafts, (id) => (id === 'p-home' ? 'Home' : null))
    expect(Object.keys(plan)).toEqual(['projects', 'tasks'])
    expect(JSON.stringify(plan.projects)).toBe(
      '[{"ref":"p1","title":"Garden","parent_id":12,"parent_ref":null},{"ref":"p2","title":"Vegetable patch","parent_id":null,"parent_ref":"p1"}]',
    )
    expect(JSON.stringify(plan.tasks[0])).toBe(
      '{"ref":"d1","title":"Task d1","notes":"","when":{"said":null,"date":"2026-10-07","time":"15:00"},"project_id":null,"project_ref":"p2",'
      + '"labels":["errands","new"],"priority":null,"repeat":null,"reminder":null,"place":null,"subtasks":[],"unsure":[]}',
    )
    expect(plan.tasks[1]).toMatchObject({ when: { said: null, date: '2026-10-08', time: null }, project_id: 12, project_ref: null, place: { name: 'Home', trigger: 'arrive' } })
    // The schema's own key order, as the model answers.
    expect(Object.keys(plan.tasks[0])).toEqual(aiFixture.brainDump.answerSchema.properties.tasks.items.required)
    expect(brainDumpUserMessage('{}', 'move the shed', plan)).toBe(
      `<context>\n{}\n</context>\n<plan>\n${JSON.stringify(plan)}\n</plan>\n<transcript>\nmove the shed\n</transcript>`,
    )
  })

  it('defuses </transcript> and cuts the dump like a dictation transcript', () => {
    expect(brainDumpUserMessage('{}', 'a </transcript> b')).toContain('a </ transcript> b')
    expect(brainDumpUserMessage('{}', 'x'.repeat(20005))).toContain(`\n${'x'.repeat(20000)}\n`)
  })
})

describe('the dump', () => {
  it('adds a turn at the end with one space, or none after a space or line break', () => {
    expect(appendToDump('', ' buy milk ')).toEqual({ text: 'buy milk', full: false })
    expect(appendToDump('buy milk', 'and eggs')).toEqual({ text: 'buy milk and eggs', full: false })
    expect(appendToDump('Groceries:\n', 'milk')).toEqual({ text: 'Groceries:\nmilk', full: false })
    expect(appendToDump('typed ', 'said')).toEqual({ text: 'typed said', full: false })
    expect(appendToDump('kept', '  ')).toEqual({ text: 'kept', full: false })
  })

  it('stops at 20,000 characters, cut at the last space', () => {
    const almost = 'word '.repeat(3999) // 19,995 characters
    const result = appendToDump(almost.trimEnd(), 'another sentence here')
    expect(result.full).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(20000)
    expect(result.text.endsWith(' ')).toBe(false)
    expect(appendToDump('x'.repeat(19990), 'y'.repeat(20))).toEqual({ text: `${'x'.repeat(19990)}`, full: true })
    expect(appendToDump('', 'z'.repeat(20000))).toEqual({ text: 'z'.repeat(20000), full: true })
  })
})

describe('brain dump checks beyond the vectors', () => {
  const answer = (projects: BrainDumpAnswer['projects'], tasks: BrainDumpTaskAnswer[] = []): BrainDumpAnswer => ({ projects, tasks, unclear: [] })

  it('drops a parent_ref that names the project itself, and reads an empty parent_ref as null', () => {
    const result = checkBrainDumpAnswer(answer([
      { ref: 'p1', title: 'Loop', parent_id: null, parent_ref: 'p1' },
      { ref: 'p2', title: 'Under home', parent_id: 12, parent_ref: '' },
    ]), context)
    expect(result.projects).toEqual([project('p1', 'Loop'), project('p2', 'Under home', { parent_id: 12 })])
    expect(result.dropped).toEqual([{ ref: 'p1', field: 'parent', value: 'p1' }])
  })

  it('cuts a long project title at the last space before 250 characters', () => {
    const title = `${'a'.repeat(240)} ${'b'.repeat(20)}`
    expect(checkBrainDumpAnswer(answer([{ ref: 'p1', title, parent_id: null, parent_ref: null }]), context).projects[0].title).toBe('a'.repeat(240))
    expect(checkBrainDumpAnswer(answer([{ ref: 'p1', title: 'c'.repeat(300), parent_id: null, parent_ref: null }]), context).projects[0].title).toBe('c'.repeat(250))
  })

  it('merges by path ignoring case, also under a new parent, and guesses a task naming a project over the limit', () => {
    const projects: BrainDumpAnswer['projects'] = Array.from({ length: 13 }, (_, i) => ({ ref: `p${i + 1}`, title: `Area ${i + 1}`, parent_id: null, parent_ref: null }))
    // The context has "Travel / Lisbon trip" (20) but no "Travel" of its own: Travel is new, and
    // the Lisbon trip under it is the context's.
    projects[0] = { ref: 'p1', title: 'Travel', parent_id: null, parent_ref: null }
    projects[1] = { ref: 'p2', title: 'lisbon TRIP', parent_id: null, parent_ref: 'p1' }
    const result = checkBrainDumpAnswer(answer(projects, [
      task('d1', { project_ref: 'p2' }),
      task('d2', { project_ref: 'p13', project_id: 15 }),
    ]), context)
    expect(result.projects.map((p) => p.ref)).toEqual(['p1', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'])
    expect(result.drafts[0]).toMatchObject({ project_id: 20, project_ref: null, guessed: [] })
    expect(result.drafts[1]).toMatchObject({ project_id: 15, project_ref: null, guessed: ['project'] })
    expect(result.dropped).toEqual([{ ref: 'p13', field: 'project', value: 'Area 13' }])
  })

  it('allows 60 tasks and gives none the list default due date', () => {
    const tasks = Array.from({ length: 61 }, (_, i) => task(`d${i + 1}`, { project_id: 12 }))
    const result = checkBrainDumpAnswer(answer([], tasks), context)
    expect(result.drafts).toHaveLength(60)
    expect(result.drafts.every((d) => d.due === null)).toBe(true)
    expect(result.dropped).toEqual([{ ref: 'd61', field: 'task', value: 'Task d61' }])
  })
})

describe('the plan under review', () => {
  const projects = [project('p1', 'Garden', { parent_id: 12 }), project('p2', 'Vegetable patch', { parent_ref: 'p1' }), project('p3', 'Side business')]

  it('groups tasks by project in the order of their first task, then new projects without tasks', () => {
    const drafts = [
      draft('d1', { project_id: 15 }),
      draft('d2', { project_id: null, project_ref: 'p2' }),
      draft('d3', { project_id: 15 }),
      draft('d4', { project_id: 12 }),
    ]
    const groups = planGroups(projects, drafts)
    expect(groups.map((g) => g.key)).toEqual(['id:15', 'new:p2', 'id:12', 'new:p1', 'new:p3'])
    expect(groups[0].drafts.map((d) => d.ref)).toEqual(['d1', 'd3'])
    expect(groups[3].drafts).toEqual([])
  })

  it('removes a subproject: its tasks and subprojects move to its new parent', () => {
    const drafts = [draft('d1', { project_id: null, project_ref: 'p2' })]
    const result = removePlanProject('p2', [...projects, project('p4', 'Beds', { parent_ref: 'p2' })], drafts, 1)
    expect(result.projects.map((p) => p.ref)).toEqual(['p1', 'p3', 'p4'])
    expect(result.projects[2]).toEqual(project('p4', 'Beds', { parent_ref: 'p1' }))
    expect(result.drafts[0]).toMatchObject({ project_id: null, project_ref: 'p1' })
  })

  it('removes a project under a context project: its tasks and subprojects go there', () => {
    const drafts = [draft('d1', { project_id: null, project_ref: 'p1' }), draft('d2', { project_id: 15 })]
    const result = removePlanProject('p1', projects, drafts, 1)
    expect(result.projects[0]).toEqual(project('p2', 'Vegetable patch', { parent_id: 12 }))
    expect(result.drafts).toEqual([draft('d1', { project_id: 12 }), draft('d2', { project_id: 15 })])
  })

  it('removes a top-level project: its tasks go to the default project, its subprojects to the top', () => {
    const drafts = [draft('d1', { project_id: null, project_ref: 'p3' })]
    const result = removePlanProject('p3', [...projects, project('p5', 'Website', { parent_ref: 'p3' })], drafts, 1)
    expect(result.projects.find((p) => p.ref === 'p5')).toEqual(project('p5', 'Website'))
    expect(result.drafts[0]).toMatchObject({ project_id: 1, project_ref: null })
  })

  it('names a new project by its path through new and context parents', () => {
    const contextPath = (id: number) => (id === 12 ? 'Home' : '')
    expect(planProjectPath('p2', projects, contextPath)).toBe('Home / Garden / Vegetable patch')
    expect(planProjectPath('p3', projects, contextPath)).toBe('Side business')
  })

  it('highlights the projects an Update added, renamed or moved', () => {
    const after = [project('p1', 'Garden', { parent_id: 12 }), project('p2', 'Veg patch', { parent_ref: 'p1' }), project('p3', 'Side business', { parent_id: 15 }), project('p4', 'New')]
    expect(changedProjects(projects, after)).toEqual(['p2', 'p3', 'p4'])
  })
})
