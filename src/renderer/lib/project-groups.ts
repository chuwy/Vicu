// The project lists that show the Inbox among the projects (Settings → Projects, the project
// picker) group them like the sidebar (cross-app semantics 13.3), with the Inbox in the group
// without a category.

import type { ProjectTreeNode } from '@/hooks/use-projects'
import type { CategoryGroup, ProjectCategory } from '../../shared/project-categories'

export interface ProjectNodeGroup {
  category: ProjectCategory | null
  /** The group's top-level projects, each with its subtree. */
  nodes: ProjectTreeNode[]
}

/**
 * The layout's groups with tree nodes, and the Inbox (with its subprojects below it, as the tree
 * has them) in its place by position among the projects without a category.
 */
export function groupsWithInbox(
  tree: readonly ProjectTreeNode[],
  layout: readonly CategoryGroup[],
  inboxId: number,
): ProjectNodeGroup[] {
  const byId = new Map<number, ProjectTreeNode>()
  const index = (nodes: readonly ProjectTreeNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node)
      index(node.children)
    }
  }
  index(tree)

  const inbox = inboxId ? tree.find((node) => node.id === inboxId) : undefined
  const insideInbox = new Set<number>()
  const below = (node: ProjectTreeNode) => {
    for (const child of node.children) {
      insideInbox.add(child.id)
      below(child)
    }
  }
  if (inbox) below(inbox)

  return layout.map((group) => {
    const nodes = group.projectIds.filter((id) => !insideInbox.has(id)).flatMap((id) => byId.get(id) ?? [])
    if (group.category === null && inbox) {
      const at = nodes.findIndex((node) => node.position > inbox.position || (node.position === inbox.position && node.id > inbox.id))
      nodes.splice(at < 0 ? nodes.length : at, 0, inbox)
    }
    return { category: group.category, nodes }
  })
}
