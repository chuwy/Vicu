/**
 * Adding a brain dump's plan (docs/ai-assistant-v1.md section 4.8.5): the new projects in order
 * through the app's own New project path (a parent always before its subprojects), then the drafts
 * through add-drafts.ts with the new projects' ids. A project that cannot be created stops Add
 * before any task, and the projects made so far are deleted again. Undo deletes the tasks, then the
 * projects. The writes are injected so this stays testable.
 */
import type { AddDraftsResult } from './add-drafts'
import type { BrainDumpDraft, CheckedProject } from '../../../shared/ai/brain-dump'
import type { CheckedDraft } from '../../../shared/ai/dictation'
import type { Project, Task } from '../vikunja-types'

export interface AddBrainDumpDeps {
  /** The app's New project path, under `parentId` (null: the top level). */
  createProject(title: string, parentId: number | null): Promise<Project>
  deleteProject(id: number): Promise<void>
  /** The drafts through the path quick add uses (4.5). */
  addDrafts(drafts: readonly CheckedDraft[]): Promise<AddDraftsResult>
  /** Where a task goes when its new project is missing from the plan. */
  defaultProjectId: number
}

export type AddBrainDumpOutcome =
  | { ok: true; projects: Project[]; added: AddDraftsResult }
  /** This project could not be created; the ones made before it were deleted again. */
  | { ok: false; stage: 'projects'; project: CheckedProject; error: unknown }
  /** The projects were made and a task could not be: `projectIds` gives each new project's id by ref. */
  | { ok: false; stage: 'tasks'; projects: Project[]; projectIds: Record<string, number>; error: unknown }

/** The new projects with every parent before its subprojects, otherwise in the plan's order. */
export function creationOrder(projects: readonly CheckedProject[]): CheckedProject[] {
  const byRef = new Map(projects.map((project) => [project.ref, project]))
  const ordered: CheckedProject[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()
  const place = (project: CheckedProject) => {
    // `visiting` ends a loop of parents (the checks never make one).
    if (placed.has(project.ref) || visiting.has(project.ref)) return
    visiting.add(project.ref)
    const parent = project.parent_ref !== null ? byRef.get(project.parent_ref) : undefined
    if (parent) place(parent)
    visiting.delete(project.ref)
    placed.add(project.ref)
    ordered.push(project)
  }
  projects.forEach(place)
  return ordered
}

/** A plan draft as a dictation draft for adding: its new project's id in place of its `project_ref`. */
export function draftWithProjectId(draft: BrainDumpDraft, projectIds: ReadonlyMap<string, number>, defaultProjectId: number): CheckedDraft {
  const { project_ref: ref, ...rest } = draft
  const projectId = ref !== null ? projectIds.get(ref) ?? defaultProjectId : draft.project_id ?? defaultProjectId
  return { ...rest, project_id: projectId }
}

export async function addBrainDump(
  projects: readonly CheckedProject[],
  drafts: readonly BrainDumpDraft[],
  deps: AddBrainDumpDeps,
): Promise<AddBrainDumpOutcome> {
  const ids = new Map<string, number>()
  const created: Project[] = []
  for (const project of creationOrder(projects)) {
    const parentId = project.parent_ref !== null ? ids.get(project.parent_ref) ?? null : project.parent_id
    try {
      const made = await deps.createProject(project.title, parentId)
      created.push(made)
      ids.set(project.ref, made.id)
    } catch (error) {
      // Nothing of the plan stays: subprojects are deleted before their parents.
      for (const made of [...created].reverse()) {
        try {
          await deps.deleteProject(made.id)
        } catch {
          // Already gone, or the connection dropped: nothing more to do here.
        }
      }
      return { ok: false, stage: 'projects', project, error }
    }
  }
  try {
    const added = await deps.addDrafts(drafts.map((draft) => draftWithProjectId(draft, ids, deps.defaultProjectId)))
    return { ok: true, projects: created, added }
  } catch (error) {
    return { ok: false, stage: 'tasks', projects: created, projectIds: Object.fromEntries(ids), error }
  }
}

/** Undo of Add: the tasks it made (subtasks first), then its projects (subprojects first). */
export async function undoBrainDump(
  added: Pick<AddDraftsResult, 'created'>,
  projects: readonly Project[],
  deps: { deleteTask(task: Task): Promise<void>; deleteProject(id: number): Promise<void> },
): Promise<void> {
  for (const task of [...added.created].reverse()) {
    try {
      await deps.deleteTask(task)
    } catch {
      // The app's error toast says so; the rest is still undone.
    }
  }
  for (const project of [...projects].reverse()) {
    try {
      await deps.deleteProject(project.id)
    } catch {
      // As above.
    }
  }
}

/** "Added 2 projects and 14 tasks", with the singular for one (4.8.5); dictation's "Added 3 tasks" without projects. */
export function addedMessage(projects: number, tasks: number): string {
  const projectText = projects === 1 ? '1 project' : `${projects} projects`
  const taskText = tasks === 1 ? '1 task' : `${tasks} tasks`
  if (projects === 0) return `Added ${taskText}`
  if (tasks === 0) return `Added ${projectText}`
  return `Added ${projectText} and ${taskText}`
}
