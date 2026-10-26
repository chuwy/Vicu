import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canAddCategoryAbove,
  categoryIdOfKey,
  categoryLayout,
  planAddCategoryAbove,
  planAssignProject,
  planDeleteCategory,
  planMoveCategory,
  planNewCategory,
  planRenameCategory,
  projectIdOfCategoryKey,
  type CategoryLayoutProject,
  type CategoryWrites,
} from '../project-categories'
import { readSyncedPref } from '../synced-prefs'

/**
 * The vectors of docs/cross-app-semantics-v1.md section 13 (project categories), from the
 * `projectCategories` block of test-fixtures/cross-app-semantics-v1.json. Android runs the same.
 */

interface FixtureProject { id: number; title: string; parent: number; position?: number; archived?: boolean }
interface ReadVector { name: string; entries: Record<string, unknown>; key: string; expect: unknown }
interface LayoutVector {
  name: string
  entries: Record<string, unknown>
  expect: Array<{ category: string | null; projects: number[] }>
}
type Action =
  | { type: 'new'; id: string; name: string }
  | { type: 'move'; category: string; to: number }
  | { type: 'rename'; category: string; name: string }
  | { type: 'delete'; category: string }
  | { type: 'assign'; project: number; category: string | null }
  | { type: 'split'; project: number; id: string; name: string }
interface ChangeVector { name: string; entries: Record<string, unknown>; action: Action; expectWrites: CategoryWrites }

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as {
  projectCategories: {
    inboxProjectId: number
    projects: FixtureProject[]
    read: ReadVector[]
    layout: LayoutVector[]
    changes: ChangeVector[]
  }
}

const block = fixture.projectCategories
const projects: CategoryLayoutProject[] = block.projects.map((project) => ({
  id: project.id,
  parent_project_id: project.parent,
  ...(project.position !== undefined ? { position: project.position } : {}),
  is_archived: project.archived ?? false,
}))

function apply(vector: ChangeVector): CategoryWrites | null {
  const { action, entries } = vector
  switch (action.type) {
    case 'new':
      return planNewCategory(entries, action.id, action.name)
    case 'move':
      return planMoveCategory(entries, action.category, action.to)
    case 'rename':
      return planRenameCategory(entries, action.category, action.name)
    case 'delete':
      return planDeleteCategory(entries, action.category)
    case 'assign':
      return planAssignProject(entries, action.project, action.category)
    case 'split':
      return planAddCategoryAbove(projects, block.inboxProjectId, entries, action.project, action.id, action.name)
  }
}

describe('project categories (section 13)', () => {
  describe('read', () => {
    for (const vector of block.read) {
      it(vector.name, () => {
        expect(readSyncedPref(vector.entries, vector.key)).toEqual(vector.expect)
      })
    }
  })

  describe('layout', () => {
    for (const vector of block.layout) {
      it(vector.name, () => {
        const groups = categoryLayout(projects, block.inboxProjectId, vector.entries)
        expect(groups.map((group) => ({ category: group.category?.id ?? null, projects: group.projectIds }))).toEqual(vector.expect)
      })
    }
  })

  describe('changes', () => {
    for (const vector of block.changes) {
      it(vector.name, () => {
        expect(apply(vector)).toEqual(vector.expectWrites)
      })
    }
  })
})

describe('project category keys', () => {
  it('tells category keys from assignment keys', () => {
    expect(categoryIdOfKey('category.work')).toBe('work')
    expect(categoryIdOfKey('category.project.7')).toBeNull()
    expect(categoryIdOfKey('category.project')).toBeNull()
    expect(projectIdOfCategoryKey('category.project.7')).toBe(7)
    expect(projectIdOfCategoryKey('category.project.07')).toBeNull()
    expect(projectIdOfCategoryKey('category.work')).toBeNull()
  })

  it('offers Add category above except on the first project of a category', () => {
    const values = { 'category.work': { name: 'Work', order: 1 }, 'category.project.3': 'work', 'category.project.6': 'work' }
    const layout = categoryLayout(projects, block.inboxProjectId, values)
    expect(canAddCategoryAbove(layout, 3)).toBe(false)
    expect(canAddCategoryAbove(layout, 6)).toBe(true)
    // The first project without a category takes all of them.
    expect(canAddCategoryAbove(layout, 14)).toBe(true)
    // Not top-level: a subproject, the Inbox.
    expect(canAddCategoryAbove(layout, 4)).toBe(false)
    expect(canAddCategoryAbove(layout, 1)).toBe(false)
    expect(planAddCategoryAbove(projects, block.inboxProjectId, values, 3, 'new', 'New')).toBeNull()
  })

  it('renames nothing when the name stays the same or is blank', () => {
    const values = { 'category.work': { name: 'Work', order: 1 } }
    expect(planRenameCategory(values, 'work', ' Work ')).toEqual({})
    expect(planRenameCategory(values, 'work', '  ')).toEqual({})
    expect(planRenameCategory(values, 'gone', 'Office')).toEqual({})
  })
})
