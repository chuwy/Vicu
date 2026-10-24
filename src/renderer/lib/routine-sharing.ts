// Shared routines in the renderer (docs/cross-app-semantics-v1.md section 6.9): who a routine can be
// shared with, through which project, and the texts that say so. Pure: the hooks feed it the
// projects, their members and permissions, and the routines.
import { createdById } from '../../shared/hidden-tasks'
import { routineHidden } from '../../shared/synced-prefs'
import { canMemberWrite, displayName, orderPeople } from './collaboration'
import { isFinished, isSharedRoutine, loggedByUserId, type OccurrenceStatus, type RoutineCarrier, type RoutineOccurrenceRecord } from './routines'
import type { PersonRef, Project } from './vikunja-types'

/** The explanation next to "Share with" (section 6.9, the same in both apps). */
export const SHARE_ROUTINE_EXPLANATION =
  'A shared routine is kept in a project you share with that person, so everyone in that project can see it and tick it off. ' +
  'Only people you already share a project with are listed; to share with someone else, share a project with them first, in Vicu or in Vikunja. ' +
  'Deleting that project deletes the routine and its history for everyone, and if you lose access to the project, you lose the routine.'

/** Sharing moves the routine and its history on the server, so it needs the connection. */
export const SHARE_ROUTINE_OFFLINE = 'Connect to your server to share this routine.'

/** What archiving a project that holds shared routines adds to the question. */
export const SHARED_ROUTINE_ARCHIVE_NOTE = 'Shared routines in it can’t be ticked off until it is restored.'

/** The access of a project as the collaboration provider knows it (`ProjectAccess`). */
export interface ShareAccess {
  shared: boolean
  members: readonly PersonRef[]
  permission: number
}

/** A project a routine can be shared through: shared, not archived, and you can write there. */
export interface RoutineShareProject {
  id: number
  title: string
  /** You own it: nobody else can delete it or take your access away. */
  ownedByMe: boolean
  /** Everyone who can see it, you first. */
  members: readonly PersonRef[]
}

/** A person a routine can be shared with, and the projects that would do it. */
export interface RoutineSharePerson {
  person: PersonRef
  /** The eligible projects they are in where they can tick it off, in project order. */
  projects: RoutineShareProject[]
  /** False when they can only view every eligible project they are in ("Can view only"). */
  canWrite: boolean
}

/** The projects a routine can be shared through (section 6.9: shared, not archived, permission 1 or 2). */
export function eligibleShareProjects(
  projects: readonly Project[],
  access: ReadonlyMap<number, ShareAccess>,
  me: number | null | undefined,
): RoutineShareProject[] {
  return projects.flatMap((project) => {
    const entry = access.get(project.id)
    if (project.is_archived || !entry || !entry.shared || entry.permission < 1) return []
    if (!entry.members.some((member) => member.id !== me)) return []
    return [{ id: project.id, title: project.title, ownedByMe: !!me && project.owner?.id === me, members: orderPeople(entry.members, me) }]
  })
}

/**
 * Everyone you share an eligible project with, in the order they first appear. `permissionOf` is a
 * member's permission on a project (contract 9.1; null when unknown, which counts as write).
 */
export function sharePeople(
  eligible: readonly RoutineShareProject[],
  me: number | null | undefined,
  permissionOf: (projectId: number, userId: number) => number | null,
): RoutineSharePerson[] {
  const people = new Map<number, RoutineSharePerson>()
  for (const project of eligible) {
    for (const member of project.members) {
      if (member.id === me) continue
      const entry = people.get(member.id) ?? { person: member, projects: [], canWrite: false }
      if (canMemberWrite(permissionOf(project.id, member.id))) {
        entry.projects.push(project)
        entry.canWrite = true
      }
      people.set(member.id, entry)
    }
  }
  return [...people.values()]
}

/** The projects to keep a routine in for a person, the one it is already in first. */
export function keepInChoices(person: RoutineSharePerson, currentProjectId: number | undefined): RoutineShareProject[] {
  const current = person.projects.find((project) => project.id === currentProjectId)
  return current ? [current, ...person.projects.filter((project) => project !== current)] : [...person.projects]
}

/**
 * The project to share through when there is nothing to choose: the person's only project, or the
 * one the routine is already in. Null when the user has to pick (S7: "Keep in").
 */
export function defaultShareProject(person: RoutineSharePerson, currentProjectId: number | undefined): number | null {
  if (person.projects.length === 1) return person.projects[0].id
  return person.projects.some((project) => project.id === currentProjectId) ? currentProjectId ?? null : null
}

/** A routine as one account sees it: whose it is, and whether it is shared right now. */
export interface RoutineSharing {
  /** You created it (the owner, section 6.9). */
  own: boolean
  /** Flagged shared and its project has other members right now. */
  shared: boolean
  /** The owner, for "Shared by"; null for your own routine or when unknown. */
  owner: PersonRef | null
  /** The others who can see it, for "Shared with". */
  others: PersonRef[]
  /** You can tick it off and edit it (permission 1 or 2, or your own). */
  canWrite: boolean
}

export function routineSharing(
  carrier: RoutineCarrier<{ project_id?: number; created_by?: { id?: unknown; username?: string; name?: string | null } | null }>,
  access: ShareAccess | undefined,
  me: number | null | undefined,
): RoutineSharing {
  const ownerId = createdById(carrier.task)
  // A carrier made offline has no creator yet; only this account can have made it.
  const own = ownerId === null || ownerId === me
  const flagged = isSharedRoutine(carrier.payload)
  const members = access?.members ?? []
  const shared = flagged && !!access?.shared && members.some((member) => member.id !== me)
  const ownerRef = !own && ownerId !== null
    ? members.find((member) => member.id === ownerId) ??
      { id: ownerId, username: carrier.task.created_by?.username ?? '', name: carrier.task.created_by?.name ?? null }
    : null
  return {
    own,
    shared,
    owner: ownerRef,
    others: orderPeople(members, me).filter((member) => member.id !== me),
    canWrite: own || (access?.permission ?? 1) >= 1,
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Shared with Maya", "Shared with Maya and Sam", "Shared with Maya, Sam and Lee". */
export function sharedWithText(others: readonly PersonRef[]): string {
  return others.length === 0 ? '' : `Shared with ${joinNames(others.map(displayName))}`
}

/** "Shared by Maya". */
export function sharedByText(owner: PersonRef): string {
  return `Shared by ${displayName(owner)}`
}

/**
 * "Done by Maya", "Skipped by you": who finished an occurrence of a shared routine (section 6.9).
 * Empty for an open occurrence, nobody named, or someone not among `people`.
 */
export function loggedByText(
  status: OccurrenceStatus,
  record: Pick<RoutineOccurrenceRecord, 'modifiedBy' | 'loggedBy'> | undefined,
  me: number | null | undefined,
  people: readonly PersonRef[],
): string {
  if (!isFinished(status)) return ''
  const userId = loggedByUserId(record)
  if (userId === null) return ''
  const verb = status === 'COMPLETED' ? 'Done' : 'Skipped'
  if (userId === me) return `${verb} by you`
  const person = people.find((entry) => entry.id === userId)
  return person ? `${verb} by ${displayName(person)}` : ''
}

/** The shared routines a project holds, by name, from the routines the app knows. */
export function sharedRoutinesIn(projectId: number, carriers: ReadonlyArray<RoutineCarrier<{ project_id?: number }>>): string[] {
  return carriers
    .filter((carrier) => carrier.task.project_id === projectId && isSharedRoutine(carrier.payload))
    .map((carrier) => carrier.payload.definition.name)
}

/**
 * What deleting a project that holds shared routines adds to the question (section 6.9): "It also
 * holds the shared routine “Feed the cat”. Deleting the project deletes the routine and its history
 * for everyone." Empty when it holds none.
 */
export function sharedRoutineDeleteNote(names: readonly string[]): string {
  if (names.length === 0) return ''
  const quoted = names.map((name) => `“${name}”`)
  return names.length === 1
    ? `It also holds the shared routine ${quoted[0]}. Deleting the project deletes the routine and its history for everyone.`
    : `It also holds the shared routines ${joinNames(quoted)}. Deleting the project deletes the routines and their history for everyone.`
}

/**
 * The question deleting a project asks (section 6.9): `message`, with the note on the shared
 * routines it holds (`names`), and `force` to ask it even when delete confirmations are turned off,
 * since the routines go for everyone.
 */
export function projectDeleteQuestion(message: string, names: readonly string[]): { message: string; force: boolean } {
  const note = sharedRoutineDeleteNote(names)
  return note ? { message: `${message} ${note}`, force: true } : { message, force: false }
}

/**
 * True for a shared routine someone else owns that this account hid (`routine_hidden.<id>`,
 * section 6.9): it leaves this account's lists, widgets and reminders. Your own routine never is.
 */
export function hiddenForMe(
  carrier: RoutineCarrier<{ created_by?: { id?: unknown } | null }>,
  me: number | null | undefined,
  prefs: Readonly<Record<string, unknown>>,
): boolean {
  const owner = createdById(carrier.task)
  return isSharedRoutine(carrier.payload) && owner !== null && owner !== me && routineHidden(prefs, carrier.payload.definition.id)
}
