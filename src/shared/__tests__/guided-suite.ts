import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dateOnlyDue } from '../due-dates'
import {
  GUIDED_LIMITS,
  GuidedWorld,
  addedAgo,
  ago,
  askAgenda,
  healthLine,
  inboxQueue,
  overdueQueue,
  projectHealth,
  reviewQueue,
  waitingQueue,
  weeklySteps,
  type GuidedProject,
  type GuidedTask,
} from '../guided'
import { upsertFooter, type ReviewMetadata } from '../review-metadata'
import { WEEKLY_REVIEW_LAST_KEY, readSyncedPref, readWeeklyReviewLast } from '../synced-prefs'

/**
 * The `guided` vectors of test-fixtures/cross-app-semantics-v1.json (contract section 14). Task
 * times are local wall-clock times, converted in the process time zone; the zone wrappers
 * (guided*.test.ts) set `process.env.TZ` first. Vicu mobile runs the same block (`GuidedFixtureTest`).
 * Nothing here may build a Date at module scope.
 */

interface FixtureProject {
  id: number
  title: string
  parent?: number
  archived?: boolean
  permission?: number
  review?: 'never' | 'excluded' | { last: string; cadence?: number }
}
interface FixtureTask {
  id: number
  title: string
  project: number
  done?: boolean
  due?: string | null
  due_time?: string | null
  created?: string | null
  updated?: string | null
  done_at?: string | null
  repeats?: boolean
  position?: number
  hidden?: boolean
}
interface HealthVector {
  project: number
  open: number
  untouched: number
  overdue: number
  scheduled: boolean
  last_done_days: number | null
  untouched_ids: number[]
  first_open: number | null
  line: string
}
interface Block {
  limits: Record<string, number>
  world: {
    today: string
    inboxProjectId: number
    reviewSettings: { enabled: boolean; defaultCadence: number; excludeInbox: boolean }
    projects: FixtureProject[]
    tasks: FixtureTask[]
  }
  queues: Record<'inbox' | 'overdue' | 'waiting' | 'review', number[]>
  health: HealthVector[]
  weekly: Array<{ id: string; count: number | null; ids?: number[] }>
  agenda: Array<{ name: string; weeklyReviewLast: string | null; expect: Array<{ id: string; count: number | null; detail: string | null }> }>
  ago: Array<{ days: number; expect: string }>
}

function loadBlock(): Block {
  const root = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'))
  return root.guided as Block
}

/** `2026-10-06T10:00:00` as an ISO instant in the process time zone. */
function local(value: string): string {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s = 0] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s).toISOString()
}

const NULL_DATE = '0001-01-01T00:00:00Z'

function reviewDescription(review: FixtureProject['review']): string {
  if (review === undefined || review === 'never') return ''
  const meta: ReviewMetadata = review === 'excluded'
    ? { state: 'excluded', lastReviewedAt: null, cadenceDaysOverride: null }
    : { state: 'reviewed', lastReviewedAt: review.last, cadenceDaysOverride: review.cadence ?? null }
  return upsertFooter('', meta)
}

function worldOf(block: Block, orderValues: Record<string, unknown> = {}): GuidedWorld {
  const w = block.world
  const projects: GuidedProject[] = w.projects.map((p) => ({
    id: p.id,
    title: p.title,
    description: reviewDescription(p.review),
    parent_project_id: p.parent ?? 0,
    is_archived: p.archived ?? false,
    max_permission: p.permission ?? 2,
  }))
  const tasks: GuidedTask[] = w.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.hidden ? '<!-- vicu-prefs:v1:e30 -->' : '',
    done: t.done ?? false,
    done_at: t.done_at ? local(t.done_at) : NULL_DATE,
    due_date: t.due ? (t.due_time ? local(`${t.due}T${t.due_time}:00`) : dateOnlyDue(t.due)) : NULL_DATE,
    project_id: t.project,
    position: t.position ?? 0,
    created: t.created ? local(t.created) : '',
    updated: t.updated ? local(t.updated) : '',
    repeat_after: t.repeats ? 86_400 : 0,
    repeat_mode: 0,
  }))
  return new GuidedWorld({
    tasks,
    projects,
    inboxId: w.inboxProjectId,
    today: w.today,
    review: w.reviewSettings,
    orderValues,
  })
}

export function runGuidedSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const block = loadBlock()

  describe(`guided organizing (section 14) in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 27).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    it('has the limits of the fixture', () => {
      expect(block.limits).toEqual(GUIDED_LIMITS)
    })

    it('queues', () => {
      const world = worldOf(block)
      expect(inboxQueue(world)).toEqual(block.queues.inbox)
      expect(overdueQueue(world)).toEqual(block.queues.overdue)
      expect(waitingQueue(world)).toEqual(block.queues.waiting)
      expect(reviewQueue(world)).toEqual(block.queues.review)
    })

    for (const vector of block.health) {
      it(`health of project ${vector.project}`, () => {
        const h = projectHealth(worldOf(block), vector.project)
        expect({
          project: vector.project,
          open: h.open,
          untouched: h.untouched,
          overdue: h.overdue,
          scheduled: h.scheduled,
          last_done_days: h.lastDoneDays,
          untouched_ids: h.untouchedIds,
          first_open: h.firstOpen,
          line: healthLine(h),
        }).toEqual(vector)
      })
    }

    it('weekly review steps', () => {
      const steps = weeklySteps(worldOf(block)).map((step) => ({
        id: step.id,
        count: step.count,
        ...(step.id === 'done' || step.id === 'upcoming' ? { ids: step.ids } : {}),
      }))
      expect(steps).toEqual(block.weekly)
    })

    it('weekly review leaves out the review step while reviews are off', () => {
      const off = { ...block, world: { ...block.world, reviewSettings: { ...block.world.reviewSettings, enabled: false } } }
      expect(weeklySteps(worldOf(off)).map((step) => step.id)).toEqual(['inbox', 'mind', 'done', 'overdue', 'upcoming', 'waiting'])
      expect(reviewQueue(worldOf(off))).toEqual([])
    })

    for (const vector of block.agenda) {
      it(`agenda: ${vector.name}`, () => {
        const items = askAgenda(worldOf(block), vector.weeklyReviewLast).map(({ id, count, detail }) => ({ id, count, detail }))
        expect(items).toEqual(vector.expect)
      })
    }

    it('the Inbox queue follows the Inbox task order', () => {
      const world = worldOf(block, { 'task_order.project.1': 'title' })
      expect(inboxQueue(world)).toEqual([103, 101, 102])
      expect(inboxQueue(worldOf(block, { task_order: 'newest' }))).toEqual([102, 103, 101])
    })

    it('a card says when the task was added', () => {
      const world = worldOf(block)
      expect(addedAgo(world.task(101)!, world.today)).toBe('Added 3 weeks ago')
      expect(addedAgo({ id: 1, project_id: 1, created: '' }, world.today)).toBeNull()
    })
  })
}

describe('ago (section 14.6)', () => {
  for (const vector of loadBlock().ago) {
    it(`${vector.days} days`, () => {
      expect(ago(vector.days)).toBe(vector.expect)
    })
  }
})

describe('weekly_review.last', () => {
  it('reads a real local date only', () => {
    expect(readWeeklyReviewLast('2026-10-20')).toBe('2026-10-20')
    expect(readWeeklyReviewLast('2026-02-30')).toBeNull()
    expect(readWeeklyReviewLast('last week')).toBeNull()
    expect(readWeeklyReviewLast(20261020)).toBeNull()
    expect(readWeeklyReviewLast(null)).toBeNull()
    expect(readSyncedPref({ [WEEKLY_REVIEW_LAST_KEY]: '2026-10-20' }, WEEKLY_REVIEW_LAST_KEY)).toBe('2026-10-20')
    expect(readSyncedPref({}, WEEKLY_REVIEW_LAST_KEY)).toBeNull()
  })
})
