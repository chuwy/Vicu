// Where a project goes when the project list has categories (cross-app semantics section 13). A
// category only decides which group a top-level project is in; its position (Vikunja's) decides
// where in that group. So a drop past a category header, or before or after a top-level project
// of another group, is a position among that group's top-level projects plus, when it changes,
// the project's `category.project.<id>` entry. Drops into a project and among subprojects stay
// as project-moves.ts plans them.

import {
  categoryLayout,
  groupOfProject,
  planAssignProject,
  type CategoryGroup,
  type CategoryLayoutProject,
} from '../../shared/project-categories'
import {
  keyboardPlacement,
  placeRelative,
  TOP_LEVEL,
  type KeyboardMove,
  type MovableProject,
  type ProjectPlacement,
} from './project-moves'
import { planSiblingMove, POSITION_STEP } from './reorder-positions'
import type { ProjectDropTarget } from '@/stores/project-drop-store'

export type CategoryMovableProject = MovableProject & CategoryLayoutProject

/** Where a project goes: its parent and position, and the category it gets. */
export interface ProjectMove {
  /** The new parent and position, or null when they stay. */
  placement: ProjectPlacement | null
  /** The category to write (`null`: none); absent when it stays. */
  category?: string | null
}

type Values = Readonly<Record<string, unknown>>

function groupFor(layout: readonly CategoryGroup[], categoryId: string | null): CategoryGroup | null {
  return layout.find((group) => (group.category?.id ?? null) === categoryId) ?? null
}

/**
 * Put `projectId` at `index` among the top-level projects of a group (the category's id, or null
 * for the projects without one), counted without the project itself. A subproject comes out to
 * the top level; a project already shown at the top level keeps its parent (archived, or the
 * Inbox). In an empty category it goes after every top-level project. Null when nothing changes.
 */
export function placeInGroup(
  projects: readonly CategoryMovableProject[],
  inboxId: number,
  values: Values,
  projectId: number,
  categoryId: string | null,
  index: number,
): ProjectMove | null {
  const layout = categoryLayout(projects, inboxId, values)
  const group = groupFor(layout, categoryId)
  const moved = projects.find((p) => p.id === projectId)
  if (!group || !moved || projectId === inboxId) return null

  const byId = new Map(projects.map((p) => [p.id, p]))
  const current = groupOfProject(layout, projectId)
  const members = group.projectIds.map((id) => byId.get(id)!)
  const sameGroup = current === group
  const list = sameGroup ? members : [...members, moved]
  const oldIndex = list.findIndex((p) => p.id === projectId)
  const newIndex = Math.max(0, Math.min(index, list.length - 1))
  const category = Object.keys(planAssignProject(values, projectId, categoryId)).length > 0 ? categoryId : undefined

  let placement: ProjectPlacement | null = null
  if (!sameGroup || oldIndex !== newIndex) {
    const parentChanged = current === null
    const parentId = parentChanged ? TOP_LEVEL : moved.parent_project_id
    if (members.length === 0) {
      const others = layout.flatMap((g) => g.projectIds).filter((id) => id !== projectId)
      const last = Math.max(0, ...others.map((id) => byId.get(id)!.position ?? 0))
      placement = { parentId, parentChanged, position: last + POSITION_STEP, renumbered: [] }
    } else {
      const plan = planSiblingMove(list.map((p) => ({ id: p.id, position: p.position ?? 0 })), oldIndex, newIndex)
      placement = { parentId, parentChanged, position: plan.position, renumbered: plan.renumbered }
    }
  }
  if (!placement && category === undefined) return null
  return category === undefined ? { placement } : { placement, category }
}

/**
 * Where a dragged project lands for a drop target, or null when it cannot go there (on itself,
 * inside one of its own projects, inside the Inbox, or nowhere new). The PROJECTS header is the
 * end of the projects without a category; a category header is the start of that category.
 */
export function projectDropMove(
  projects: readonly CategoryMovableProject[],
  inboxId: number,
  values: Values,
  movedId: number,
  target: ProjectDropTarget,
): ProjectMove | null {
  if (target.kind === 'root') return placeInGroup(projects, inboxId, values, movedId, null, Number.MAX_SAFE_INTEGER)
  if (target.kind === 'category') return placeInGroup(projects, inboxId, values, movedId, target.categoryId, 0)
  if (target.projectId === movedId) return null
  if (target.zone === 'into') {
    if (target.projectId === inboxId) return null
    const placement = placeRelative(projects, movedId, target.projectId, 'into')
    return placement ? { placement } : null
  }
  const group = groupOfProject(categoryLayout(projects, inboxId, values), target.projectId)
  if (group) {
    const siblings = group.projectIds.filter((id) => id !== movedId)
    const at = siblings.indexOf(target.projectId)
    return placeInGroup(projects, inboxId, values, movedId, group.category?.id ?? null, target.zone === 'before' ? at : at + 1)
  }
  const placement = placeRelative(projects, movedId, target.projectId, target.zone)
  if (!placement) return null
  // Before or after the Inbox (Settings lists it among the projects without a category).
  if (target.projectId === inboxId) {
    const category = Object.keys(planAssignProject(values, movedId, null)).length > 0 ? null : undefined
    return category === undefined ? { placement } : { placement, category }
  }
  return { placement }
}

/**
 * The keyboard twin of a drag (Alt+Shift+arrows). A top-level project moves up and down within
 * its group and goes in under the project above it in that group; the rest is keyboardPlacement.
 */
export function keyboardProjectMove(
  projects: readonly CategoryMovableProject[],
  inboxId: number,
  values: Values,
  projectId: number,
  move: KeyboardMove,
): ProjectMove | null {
  const group = groupOfProject(categoryLayout(projects, inboxId, values), projectId)
  if (group && move !== 'out') {
    const index = group.projectIds.indexOf(projectId)
    if (move === 'in') {
      const above = group.projectIds[index - 1]
      const placement = above === undefined ? null : placeRelative(projects, projectId, above, 'into')
      return placement ? { placement } : null
    }
    const to = move === 'up' ? index - 1 : index + 1
    if (to < 0 || to >= group.projectIds.length) return null
    return placeInGroup(projects, inboxId, values, projectId, group.category?.id ?? null, to)
  }
  const placement = keyboardPlacement(projects, projectId, move, new Set(inboxId ? [inboxId] : []))
  return placement ? { placement } : null
}
