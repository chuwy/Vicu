/**
 * What the assistant knows about the user's lists when it builds a request or runs a tool: the
 * projects (archived ones too), the Inbox, labels, saved places, custom lists, you and each
 * project's access. Built by `useAiWorkspace` from the window's caches; the helpers here are pure.
 */
import { effectivePermission } from '../../../shared/collaboration'
import { projectPath, compareLowercased, dictationContextJson, type ContextProject } from '../../../shared/ai/dictation'
import { vocabularyHint } from '../../../shared/ai/speech-hint'
import type { CustomList, Label, PersonRef, Project } from '../vikunja-types'

export interface AiProjectAccess {
  shared: boolean
  members: PersonRef[]
  /** 0 read only, 1 read and write, 2 admin. */
  permission: number
}

export interface AiWorkspace {
  /** Every project, archived ones included. */
  projects: readonly Project[]
  inboxProjectId: number
  labels: readonly Label[]
  places: readonly { id: string; name: string }[]
  customLists: readonly CustomList[]
  me: PersonRef | null
  access: (projectId: number) => AiProjectAccess
}

/** The list the user is in, as the requests name it (4.1, 5.1), and what it gives a new task. */
export interface ListInfo {
  name: string
  /** The project a new task from this list goes to (its composer's), or null for the Inbox. */
  projectId: number | null
  /** The list's default due date, a local date (quick add in Today gives today). */
  defaultDue: string | null
  /** The project the user is in, for Ask's `list_project_id`. */
  listProjectId?: number
  /** The custom list the user is in, for Ask's `list_custom_list_id`. */
  listCustomListId?: string
}

export function isWritable(ws: AiWorkspace, project: Project): boolean {
  if (project.is_archived) return false
  const access = ws.access(project.id)
  return Math.min(access.permission, effectivePermission(project.max_permission, project.is_archived)) >= 1
}

export function pathOf(ws: AiWorkspace, projectId: number): string {
  return projectPath(projectId, ws.projects)
}

/** Projects the user can write to, not archived, with their paths (4.1). */
export function contextProjects(ws: AiWorkspace): ContextProject[] {
  return ws.projects
    .filter((project) => isWritable(ws, project))
    .map((project) => ({ id: project.id, title: project.title, path: pathOf(ws, project.id) }))
    .sort((a, b) => compareLowercased(a.path, b.path))
}

/** The project a new task of this list goes to: the list's own when the user can write to it, else the Inbox. */
export function defaultProjectFor(ws: AiWorkspace, list: ListInfo | null): number {
  const id = list?.projectId
  const project = id ? ws.projects.find((p) => p.id === id) : undefined
  return project && isWritable(ws, project) ? project.id : ws.inboxProjectId
}

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The context JSON of a dictation request (4.1). `reference` is local `YYYY-MM-DDTHH:mm[:ss]`. */
export function dictationContextFor(ws: AiWorkspace, list: ListInfo | null, reference: string): string {
  return dictationContextJson({
    now: reference,
    timeZone: timeZone(),
    list: list?.name ?? 'Inbox',
    default_project_id: defaultProjectFor(ws, list),
    projects: contextProjects(ws),
    labels: ws.labels.map((label) => label.title),
    places: ws.places.map((place) => place.name),
  })
}

/** Whisper's initial prompt from the names the user is likely to say (3.4). */
export function hintFor(ws: AiWorkspace): string | null {
  return vocabularyHint(
    ws.projects.map((project) => ({
      title: project.title,
      inbox: project.id === ws.inboxProjectId,
      writable: isWritable(ws, project) || project.is_archived,
      archived: project.is_archived,
    })),
    ws.labels.map((label) => label.title),
    ws.places.map((place) => place.name),
  )
}

const SMART_LISTS: Record<string, string> = {
  '/inbox': 'Inbox',
  '/today': 'Today',
  '/upcoming': 'Upcoming',
  '/anytime': 'Anytime',
  '/logbook': 'Logbook',
  '/review': 'Review',
  '/routines': 'Routines',
  '/search': 'Search',
  '/settings': 'Settings',
}

/**
 * The list on screen from the route and the composer defaults its TaskList registered
 * (stores/voice-list-store.ts): its name, the project and date a new task gets.
 */
export function listInfoOf(
  pathname: string,
  ws: Pick<AiWorkspace, 'projects' | 'labels' | 'customLists' | 'inboxProjectId'>,
  composer: { projectId: number | null; defaultDueDate: Date | null } | null,
  toLocalDate: (date: Date) => string,
): ListInfo {
  const base = {
    projectId: composer?.projectId ?? null,
    defaultDue: composer?.defaultDueDate ? toLocalDate(composer.defaultDueDate) : null,
  }
  const project = /^\/project\/(\d+)/.exec(pathname)
  if (project) {
    const id = Number(project[1])
    return { ...base, name: ws.projects.find((p) => p.id === id)?.title ?? 'Project', listProjectId: id }
  }
  const tag = /^\/tag\/(\d+)/.exec(pathname)
  if (tag) return { ...base, name: ws.labels.find((l) => l.id === Number(tag[1]))?.title ?? 'Tag' }
  const custom = /^\/list\/([^/]+)/.exec(pathname)
  if (custom) {
    const id = decodeURIComponent(custom[1])
    return { ...base, name: ws.customLists.find((l) => l.id === id)?.name ?? 'List', listCustomListId: id }
  }
  if (pathname === '/inbox' || pathname === '/' || pathname === '') {
    return { ...base, name: 'Inbox', listProjectId: ws.inboxProjectId || undefined }
  }
  return { ...base, name: SMART_LISTS[pathname] ?? 'Inbox' }
}
