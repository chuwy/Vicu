import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { memberPermission, projectChain, type ProjectNode, type ShareGraph } from '@/lib/collaboration'
import type { PersonRef, ProjectShares } from '@/lib/vikunja-types'
import { useProjects } from './use-projects'

// The direct and team shares of a project, for the Share dialog (cross-app semantics 9.7). Sharing
// needs the server's answer, so these calls are never queued; a change refreshes the shares and
// every project's members (a subproject inherits its parent's shares).

function projectSharesQuery(projectId: number) {
  return {
    queryKey: ['project-shares', projectId] as const,
    queryFn: async (): Promise<ProjectShares> => {
      const result = await api.fetchProjectShares(projectId)
      if (!result.success) throw apiError(result)
      return result.data
    },
  }
}

export function useProjectShares(projectId: number, enabled = true) {
  return useQuery<ProjectShares>({ ...projectSharesQuery(projectId), enabled: enabled && projectId > 0 })
}

/**
 * Each member's permission on a project (for "Can view only" in Assign, section 9.1): reads the
 * shares of the project and its parents while `enabled`. Unknown answers null, which counts as
 * read and write.
 */
export function useMemberPermissions(projectId: number, enabled: boolean): (userId: number) => number | null {
  const { data: projects } = useProjects()
  const nodes = useMemo<ProjectNode[]>(
    () => (projects?.all ?? []).map((p) => ({ id: p.id, parent: p.parent_project_id || 0, owner: p.owner?.id ?? 0 })),
    [projects],
  )
  const chain = useMemo(() => projectChain(projectId, nodes), [projectId, nodes])
  const results = useQueries({ queries: chain.map((node) => ({ ...projectSharesQuery(node.id), enabled })) })
  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  return useMemo(() => {
    const graph: ShareGraph = {
      projects: nodes,
      shares: Object.fromEntries(chain.map((node, i) => [node.id, results[i]?.data?.users.map((u) => ({ user: u.id, permission: u.permission }))])),
      teams: Object.fromEntries(
        chain.map((node, i) => [
          node.id,
          results[i]?.data?.teams.map((t) => ({ permission: t.permission, members: (t.members ?? []).map((m) => m.id) })),
        ]),
      ),
    }
    return (userId: number) => memberPermission(projectId, userId, graph)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for `results`
  }, [projectId, nodes, chain, stamp])
}

/**
 * Each member's permission on several projects at once (the "Share with" list of a routine,
 * section 6.9): reads the shares of those projects and their parents while `enabled`. Unknown
 * answers null, which counts as read and write.
 */
export function useMembersPermissions(projectIds: readonly number[], enabled: boolean): (projectId: number, userId: number) => number | null {
  const { data: projects } = useProjects()
  const nodes = useMemo<ProjectNode[]>(
    () => (projects?.all ?? []).map((p) => ({ id: p.id, parent: p.parent_project_id || 0, owner: p.owner?.id ?? 0 })),
    [projects],
  )
  const idsKey = projectIds.join(',')
  const chainIds = useMemo(() => {
    const ids = new Set<number>()
    for (const id of projectIds) for (const node of projectChain(id, nodes)) ids.add(node.id)
    return [...ids]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `idsKey` stands for `projectIds`
  }, [idsKey, nodes])
  const results = useQueries({ queries: chainIds.map((id) => ({ ...projectSharesQuery(id), enabled })) })
  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  return useMemo(() => {
    const graph: ShareGraph = {
      projects: nodes,
      shares: Object.fromEntries(chainIds.map((id, i) => [id, results[i]?.data?.users.map((u) => ({ user: u.id, permission: u.permission }))])),
      teams: Object.fromEntries(
        chainIds.map((id, i) => [
          id,
          results[i]?.data?.teams.map((t) => ({ permission: t.permission, members: (t.members ?? []).map((m) => m.id) })),
        ]),
      ),
    }
    return (projectId: number, userId: number) => memberPermission(projectId, userId, graph)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for `results`
  }, [nodes, chainIds, stamp])
}

/** Look a person up by exact username (`GET users?q=`). */
export async function findUserByUsername(username: string): Promise<PersonRef | null> {
  const query = username.trim().replace(/^@/, '')
  if (!query) return null
  const result = await api.searchUsers(query)
  if (!result.success) throw apiError(result)
  const lower = query.toLowerCase()
  return result.data.find((user) => user.username.toLowerCase() === lower) ?? null
}

export type ShareChange =
  | { kind: 'add'; username: string; permission: number }
  | { kind: 'update'; username: string; permission: number }
  | { kind: 'remove'; username: string }

export function useShareProject(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'change who the project is shared with' },
    mutationFn: async (change: ShareChange) => {
      const result =
        change.kind === 'add'
          ? await api.shareProject(projectId, change.username, change.permission)
          : change.kind === 'update'
            ? await api.updateProjectShare(projectId, change.username, change.permission)
            : await api.removeProjectShare(projectId, change.username)
      if (!result.success) throw apiError(result)
    },
    onMutate: async (change) => {
      // Show a permission change or a removal at once; an addition waits for the server's answer.
      if (change.kind === 'add') return undefined
      await qc.cancelQueries({ queryKey: ['project-shares', projectId] })
      const before = qc.getQueryData<ProjectShares>(['project-shares', projectId])
      if (before) {
        const users =
          change.kind === 'remove'
            ? before.users.filter((u) => u.username !== change.username)
            : before.users.map((u) => (u.username === change.username ? { ...u, permission: change.permission } : u))
        qc.setQueryData<ProjectShares>(['project-shares', projectId], { ...before, users })
      }
      return { before }
    },
    onError: (_error, _change, context) => {
      if (context?.before) qc.setQueryData(['project-shares', projectId], context.before)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['project-shares', projectId] })
      void qc.invalidateQueries({ queryKey: ['project-members'] })
    },
  })
}
