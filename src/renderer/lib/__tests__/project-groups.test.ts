import { describe, expect, it } from 'vitest'
import { buildProjectTree } from '@/hooks/use-projects'
import { groupsWithInbox } from '../project-groups'
import { categoryLayout } from '../../../shared/project-categories'
import type { Project } from '@/lib/vikunja-types'

const project = (id: number, parent: number, position: number): Project =>
  ({ id, title: `P${id}`, parent_project_id: parent, position, is_archived: false }) as Project

// Groceries (2), Inbox (1) with Someday (9), Client A (3, Work), Garden (7)
const projects = [project(1, 0, 150), project(2, 0, 100), project(3, 0, 300), project(7, 0, 700), project(9, 1, 50)]
const tree = buildProjectTree(projects)

describe('groupsWithInbox', () => {
  it('puts the Inbox, with its subprojects below it, among the projects without a category by position', () => {
    const values = { 'category.work': { name: 'Work', order: 1 }, 'category.project.3': 'work' }
    const groups = groupsWithInbox(tree, categoryLayout(projects, 1, values), 1)
    expect(groups.map((group) => ({ category: group.category?.id ?? null, ids: group.nodes.map((node) => node.id) }))).toEqual([
      { category: null, ids: [2, 1, 7] },
      { category: 'work', ids: [3] },
    ])
    expect(groups[0].nodes[1].children.map((node) => node.id)).toEqual([9])
  })

  it('is the tree order when there is no category', () => {
    const groups = groupsWithInbox(tree, categoryLayout(projects, 1, {}), 1)
    expect(groups).toHaveLength(1)
    expect(groups[0].nodes.map((node) => node.id)).toEqual(tree.map((node) => node.id))
  })
})
