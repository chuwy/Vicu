import { describe, expect, it } from 'vitest'
import { keyboardProjectMove, placeInGroup, projectDropMove, type CategoryMovableProject } from '../project-category-moves'
import { TOP_LEVEL } from '../project-moves'
import { POSITION_STEP } from '../reorder-positions'

const S = POSITION_STEP
const INBOX = 1

// Inbox (1)
//   Someday (9)               top-level: its parent is the Inbox
// Groceries (2)               no category
// Client A (3)                Work
//   Invoices (4)
// Client B (5)                Work
// House (6)                   Home
// Garden (7)                  no category
// Running (8)                 no category
const projects: CategoryMovableProject[] = [
  { id: 1, parent_project_id: 0, position: 1 * S },
  { id: 2, parent_project_id: 0, position: 2 * S },
  { id: 3, parent_project_id: 0, position: 3 * S },
  { id: 4, parent_project_id: 3, position: 1 * S },
  { id: 5, parent_project_id: 0, position: 5 * S },
  { id: 6, parent_project_id: 0, position: 6 * S },
  { id: 7, parent_project_id: 0, position: 7 * S },
  { id: 8, parent_project_id: 0, position: 8 * S },
  { id: 9, parent_project_id: 1, position: 9 * S },
]
const values = {
  'category.work': { name: 'Work', order: 1 * S },
  'category.home': { name: 'Home', order: 2 * S },
  'category.later': { name: 'Later', order: 3 * S },
  'category.project.3': 'work',
  'category.project.5': 'work',
  'category.project.6': 'home',
}

describe('placeInGroup', () => {
  it('puts a project of another group at the start of a category, with its entry', () => {
    const move = placeInGroup(projects, INBOX, values, 2, 'work', 0)
    expect(move).toEqual({ placement: { parentId: 0, parentChanged: false, position: 1.5 * S, renumbered: [] }, category: 'work' })
  })

  it('moves within a group without writing the category', () => {
    const move = placeInGroup(projects, INBOX, values, 5, 'work', 0)
    expect(move).toEqual({ placement: { parentId: 0, parentChanged: false, position: 1.5 * S, renumbered: [] } })
  })

  it('changes nothing at its own place', () => {
    expect(placeInGroup(projects, INBOX, values, 5, 'work', 1)).toBeNull()
  })

  it('brings a subproject out to the top level', () => {
    const move = placeInGroup(projects, INBOX, values, 4, 'home', 1)
    expect(move?.placement).toMatchObject({ parentId: TOP_LEVEL, parentChanged: true, position: 6.5 * S })
    expect(move?.category).toBe('home')
  })

  it('keeps the Inbox as the parent of a project shown at the top level under it', () => {
    const move = placeInGroup(projects, INBOX, values, 9, 'home', 0)
    expect(move?.placement).toMatchObject({ parentId: INBOX, parentChanged: false })
    expect(move?.category).toBe('home')
  })

  it('puts a project in an empty category after every top-level project', () => {
    const move = placeInGroup(projects, INBOX, values, 2, 'later', 0)
    expect(move).toEqual({ placement: { parentId: 0, parentChanged: false, position: 10 * S, renumbered: [] }, category: 'later' })
  })

  it('refuses the Inbox and a category that is not there', () => {
    expect(placeInGroup(projects, INBOX, values, INBOX, null, 0)).toBeNull()
    expect(placeInGroup(projects, INBOX, values, 2, 'gone', 0)).toBeNull()
  })
})

describe('projectDropMove', () => {
  it('takes a project to the start of a category on its header', () => {
    const move = projectDropMove(projects, INBOX, values, 7, { kind: 'category', dndId: 'h', categoryId: 'home' })
    expect(move?.category).toBe('home')
    expect(move?.placement?.position).toBe(3 * S)
  })

  it('puts a project dropped on the PROJECTS header last among the projects without a category', () => {
    // Half a step past Someday, the last of them.
    const move = projectDropMove(projects, INBOX, values, 3, { kind: 'root', dndId: 'r' })
    expect(move).toEqual({ placement: { parentId: 0, parentChanged: false, position: 9.5 * S, renumbered: [] }, category: null })
  })

  it('places a project before or after a top-level row in that row\'s group', () => {
    const after = projectDropMove(projects, INBOX, values, 2, { kind: 'row', dndId: 'p', projectId: 3, zone: 'after' })
    expect(after).toEqual({ placement: { parentId: 0, parentChanged: false, position: 4 * S, renumbered: [] }, category: 'work' })
    const before = projectDropMove(projects, INBOX, values, 8, { kind: 'row', dndId: 'p', projectId: 7, zone: 'before' })
    expect(before?.category).toBeUndefined()
    // Between Groceries and Garden.
    expect(before?.placement?.position).toBe(4.5 * S)
  })

  it('leaves drops into a project and among subprojects to the tree rules', () => {
    const into = projectDropMove(projects, INBOX, values, 2, { kind: 'row', dndId: 'p', projectId: 3, zone: 'into' })
    expect(into).toEqual({ placement: expect.objectContaining({ parentId: 3, parentChanged: true }) })
    expect(projectDropMove(projects, INBOX, values, 2, { kind: 'row', dndId: 'p', projectId: INBOX, zone: 'into' })).toBeNull()
    const sibling = projectDropMove(projects, INBOX, values, 2, { kind: 'row', dndId: 'p', projectId: 4, zone: 'after' })
    expect(sibling).toEqual({ placement: expect.objectContaining({ parentId: 3, parentChanged: true }) })
  })

  it('clears the category of a project dropped next to the Inbox (Settings)', () => {
    const move = projectDropMove(projects, INBOX, values, 3, { kind: 'row', dndId: 'p', projectId: INBOX, zone: 'before' })
    expect(move?.category).toBeNull()
  })
})

describe('keyboardProjectMove', () => {
  it('moves a top-level project within its category and stops at its edges', () => {
    expect(keyboardProjectMove(projects, INBOX, values, 5, 'up')?.placement?.position).toBe(1.5 * S)
    expect(keyboardProjectMove(projects, INBOX, values, 3, 'up')).toBeNull()
    expect(keyboardProjectMove(projects, INBOX, values, 5, 'down')).toBeNull()
    // Among the projects without a category, Garden's neighbour above is Groceries.
    expect(keyboardProjectMove(projects, INBOX, values, 7, 'up')?.placement?.position).toBe(1 * S)
  })

  it('goes in under the project above it in its group', () => {
    expect(keyboardProjectMove(projects, INBOX, values, 5, 'in')).toEqual({
      placement: expect.objectContaining({ parentId: 3, parentChanged: true }),
    })
  })
})
