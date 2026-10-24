import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHARED_ROUTINE_ARCHIVE_NOTE,
  defaultShareProject,
  hiddenForMe,
  eligibleShareProjects,
  keepInChoices,
  loggedByText,
  routineSharing,
  sharePeople,
  sharedByText,
  projectDeleteQuestion,
  sharedRoutineDeleteNote,
  sharedRoutinesIn,
  sharedWithText,
  type ShareAccess,
} from '../routine-sharing'
import { statusRecord, type RoutinePayload } from '../routines'
import type { PersonRef, Project } from '../vikunja-types'

// Who a routine can be shared with and the texts that say so (cross-app semantics 6.9).

const ME = 1
const you: PersonRef = { id: ME, username: 'uiverify', name: '' }
const maya: PersonRef = { id: 2, username: 'uimaya', name: 'Maya' }
const sam: PersonRef = { id: 3, username: 'uisam', name: 'Sam' }
const lee: PersonRef = { id: 4, username: 'lee', name: '' }

function project(id: number, title: string, over: Partial<Project> = {}): Project {
  return { id, title, description: '', parent_project_id: 0, is_archived: false, hex_color: '', position: 0, created: '', updated: '', owner: you, ...over } as Project
}

function routine(shared?: boolean): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'feed-cat', name: 'Feed the cat', kind: 'HEALTH', healthSubtype: null, amount: '', unit: '', iconName: '', color: '',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2026-01-01' },
      slots: [{ id: 's1', label: '08:00', period: 'MORNING', reminderMinutes: 480, reminderEnabled: true, followUpMinutes: 0 }],
      activeFrom: '2026-01-01', archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'x',
      ...(shared === undefined ? {} : { shared }),
    },
    occurrences: {},
    prunedBefore: '',
  }
}

describe('eligible projects and people', () => {
  const projects = [
    project(10, 'Home', { owner: maya }),
    project(11, 'Trip to Lisbon'),
    project(12, 'Private'),
    project(13, 'Read only', { owner: sam }),
    project(14, 'Archived', { is_archived: true }),
  ]
  const access = new Map<number, ShareAccess>([
    [10, { shared: true, members: [maya, you], permission: 1 }],
    [11, { shared: true, members: [you, maya, sam], permission: 2 }],
    [12, { shared: false, members: [you], permission: 2 }],
    [13, { shared: true, members: [sam, you], permission: 0 }],
    [14, { shared: true, members: [you, lee], permission: 2 }],
  ])

  it('takes shared projects you can write to, not archived ones', () => {
    const eligible = eligibleShareProjects(projects, access, ME)
    expect(eligible.map((p) => p.id)).toEqual([10, 11])
    expect(eligible.map((p) => p.ownedByMe)).toEqual([false, true])
    expect(eligible[0].members.map((m) => m.id)).toEqual([ME, 2])
  })

  it('lists each person once, the ones who can only view every eligible project disabled', () => {
    const eligible = eligibleShareProjects(projects, access, ME)
    const permission = (projectId: number, userId: number) => (userId === 3 ? 0 : projectId === 10 && userId === 2 ? 2 : null)
    const people = sharePeople(eligible, ME, permission)
    expect(people.map((p) => [p.person.id, p.canWrite, p.projects.map((x) => x.id)])).toEqual([
      [2, true, [10, 11]],
      [3, false, []],
    ])
  })

  it('needs no choice for one project, or when the routine is already in one of them', () => {
    const eligible = eligibleShareProjects(projects, access, ME)
    const [mayaEntry] = sharePeople(eligible, ME, () => null)
    expect(defaultShareProject(mayaEntry, undefined)).toBeNull()
    expect(defaultShareProject(mayaEntry, 11)).toBe(11)
    expect(keepInChoices(mayaEntry, 11).map((p) => p.id)).toEqual([11, 10])
    const onlyHome = { ...mayaEntry, projects: [mayaEntry.projects[0]] }
    expect(defaultShareProject(onlyHome, undefined)).toBe(10)
  })
})

describe('how a routine is shared, as one account sees it', () => {
  const access: ShareAccess = { shared: true, members: [maya, you, sam], permission: 1 }

  it("your shared routine: shared with the others, while the project has them", () => {
    const sharing = routineSharing({ task: { project_id: 11, created_by: { id: ME, username: 'uiverify' } }, payload: routine(true) }, access, ME)
    expect(sharing).toMatchObject({ own: true, shared: true, canWrite: true, owner: null })
    expect(sharedWithText(sharing.others)).toBe('Shared with Maya and Sam')
    const alone = routineSharing({ task: { project_id: 11, created_by: { id: ME } }, payload: routine(true) }, { shared: false, members: [you], permission: 2 }, ME)
    expect(alone.shared).toBe(false)
    expect(routineSharing({ task: { project_id: 11, created_by: { id: ME } }, payload: routine() }, access, ME).shared).toBe(false)
  })

  it("someone else's: shared by them; a view-only member cannot tick it", () => {
    const sharing = routineSharing({ task: { project_id: 10, created_by: { id: 2, username: 'uimaya' } }, payload: routine(true) }, access, ME)
    expect(sharing.own).toBe(false)
    expect(sharedByText(sharing.owner!)).toBe('Shared by Maya')
    const viewOnly = routineSharing({ task: { project_id: 10, created_by: { id: 2 } }, payload: routine(true) }, { ...access, permission: 0 }, ME)
    expect(viewOnly.canWrite).toBe(false)
  })

  it('names in the contract form', () => {
    expect(sharedWithText([maya])).toBe('Shared with Maya')
    expect(sharedWithText([maya, sam, lee])).toBe('Shared with Maya, Sam and lee')
    expect(sharedWithText([])).toBe('')
  })
})

describe('who logged it', () => {
  const record = (userId: number, device = 'phone-a') => ({ modifiedBy: 'phone-a', loggedBy: { userId, deviceId: device } })

  it('says done or skipped by a member, or by you', () => {
    expect(loggedByText('COMPLETED', record(2), ME, [you, maya])).toBe('Done by Maya')
    expect(loggedByText('SKIPPED', record(2), ME, [you, maya])).toBe('Skipped by Maya')
    expect(loggedByText('COMPLETED', record(ME), ME, [you, maya])).toBe('Done by you')
    expect(loggedByText('SKIPPED', record(ME), ME, [you])).toBe('Skipped by you')
  })

  it('names nobody for an open occurrence, a stale loggedBy or a stranger', () => {
    expect(loggedByText('PENDING', record(2), ME, [maya])).toBe('')
    expect(loggedByText('NOT_LOGGED', record(2), ME, [maya])).toBe('')
    expect(loggedByText('COMPLETED', record(2, 'phone-b'), ME, [maya])).toBe('')
    expect(loggedByText('COMPLETED', record(9), ME, [maya])).toBe('')
    expect(loggedByText('COMPLETED', undefined, ME, [maya])).toBe('')
  })
})

describe('project questions', () => {
  it('names the shared routines a project holds', () => {
    const carriers = [
      { task: { project_id: 10 }, payload: routine(true) },
      { task: { project_id: 10 }, payload: { ...routine(), definition: { ...routine().definition, name: 'Private one' } } },
      { task: { project_id: 11 }, payload: { ...routine(true), definition: { ...routine(true).definition, name: 'Water plants' } } },
    ]
    expect(sharedRoutinesIn(10, carriers)).toEqual(['Feed the cat'])
    expect(sharedRoutineDeleteNote(['Feed the cat'])).toBe(
      'It also holds the shared routine “Feed the cat”. Deleting the project deletes the routine and its history for everyone.')
    expect(sharedRoutineDeleteNote(['A', 'B'])).toBe(
      'It also holds the shared routines “A” and “B”. Deleting the project deletes the routines and their history for everyone.')
    expect(sharedRoutineDeleteNote([])).toBe('')
    // Asked even with delete confirmations off, when it holds a shared routine.
    expect(projectDeleteQuestion('Delete “Lisbon”?', ['Feed the cat'])).toEqual({
      message: 'Delete “Lisbon”? It also holds the shared routine “Feed the cat”. Deleting the project deletes the routine and its history for everyone.',
      force: true,
    })
    expect(projectDeleteQuestion('Delete “Lisbon”?', [])).toEqual({ message: 'Delete “Lisbon”?', force: false })
    expect(SHARED_ROUTINE_ARCHIVE_NOTE).toBe('Shared routines in it can’t be ticked off until it is restored.')
  })
})

describe('a logged record of a shared routine says who (statusRecord)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => 'desktop-1', setItem: () => undefined })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes loggedBy with this device on a shared routine, none on a private one', () => {
    const slot = routine().definition.slots[0]
    const shared = statusRecord(routine(true), '2026-10-06', slot, 'COMPLETED', '', 2)
    expect(shared.loggedBy).toEqual({ userId: 2, deviceId: 'desktop-1' })
    expect(shared.modifiedBy).toBe('desktop-1')
    const previous = routine()
    previous.occurrences[shared.key] = { ...shared, extra: 'kept' } as typeof shared
    const privateRecord = statusRecord(previous, '2026-10-06', slot, 'SKIPPED', '', 2)
    expect(privateRecord.loggedBy).toBeUndefined()
    expect((privateRecord as unknown as { extra: string }).extra).toBe('kept')
  })
})

describe('hiding a shared routine for yourself', () => {
  it("hides someone else's shared routine you hid, never your own or a private one", () => {
    const prefs = { 'routine_hidden.feed-cat': true }
    expect(hiddenForMe({ task: { created_by: { id: 2 } }, payload: routine(true) }, ME, prefs)).toBe(true)
    expect(hiddenForMe({ task: { created_by: { id: ME } }, payload: routine(true) }, ME, prefs)).toBe(false)
    expect(hiddenForMe({ task: { created_by: { id: 2 } }, payload: routine() }, ME, prefs)).toBe(false)
    expect(hiddenForMe({ task: { created_by: { id: 2 } }, payload: routine(true) }, ME, { 'routine_hidden.feed-cat': null })).toBe(false)
  })
})
