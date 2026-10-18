import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carrierToWrite, isHiddenTask, ownCarriers, pruneTombstoneRecords } from '../hidden-tasks'
import {
  mergeSyncedPrefs,
  readSyncedPref,
  shouldMoveLocalPref,
  type SyncedPrefsDocument,
} from '../synced-prefs'
import { canReorderTask, resolveTaskOrder, sortTasksByOrder, type OrderableTask } from '../task-order'

/**
 * The vectors of docs/cross-app-semantics-v1.md sections 10 (hidden tasks), 11 (synced
 * preferences) and 12 (task order), from the `hiddenTasks`, `syncedPrefs` and `taskOrder` blocks of
 * test-fixtures/cross-app-semantics-v1.json. Android runs the same vectors.
 */

interface MarkerVector { name: string; title: string; description: string | null; hidden: boolean }
interface OwnershipVector {
  name: string
  me: number | null
  carriers: Array<{ id: number; createdBy: number | null }>
  use: number[]
  write: number | null
}
interface TombstoneVectors {
  nowMs: number
  records: Array<{ id: string; wallTimeMs: number; hasValue: boolean }>
  keep: string[]
}
interface MergeVector { name: string; local: SyncedPrefsDocument; server: SyncedPrefsDocument; expect: SyncedPrefsDocument }
interface ReadVector { name: string; entries: Record<string, unknown>; key: string; expect: unknown }
interface MoveVector { name: string; key: string; local: unknown; carrier?: unknown; expectWrite: boolean }
interface OrderTask { id: number; title: string; due: string | null; priority: number; position?: number; created: string | null }

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as {
  hiddenTasks: { markers: MarkerVector[]; ownership: OwnershipVector[]; tombstones: TombstoneVectors }
  syncedPrefs: { merge: MergeVector[]; read: ReadVector[]; move: MoveVector[] }
  taskOrder: {
    tasks: OrderTask[]
    sort: Array<{ order: string; expect: number[] }>
    resolve: { parents: Record<string, number>; vectors: Array<{ name: string; entries: Record<string, unknown>; expect: Record<string, string> }> }
    drag: Array<{ order: string; expect: number[] }>
  }
}

describe('hidden tasks (section 10)', () => {
  describe('markers', () => {
    for (const vector of fixture.hiddenTasks.markers) {
      it(vector.name, () => {
        expect(isHiddenTask(vector.description)).toBe(vector.hidden)
      })
    }
  })

  describe('ownership', () => {
    for (const vector of fixture.hiddenTasks.ownership) {
      it(vector.name, () => {
        const tasks = vector.carriers.map((carrier) => ({
          id: carrier.id,
          ...(carrier.createdBy === null ? {} : { created_by: { id: carrier.createdBy } }),
        }))
        expect(ownCarriers(tasks, vector.me).map((task) => task.id)).toEqual(vector.use)
        expect(carrierToWrite(tasks, vector.me)?.id ?? null).toBe(vector.write)
      })
    }
  })

  it('tombstones older than 90 days are dropped, values and recent tombstones kept', () => {
    const { nowMs, records, keep } = fixture.hiddenTasks.tombstones
    const map = Object.fromEntries(records.map((record) => [record.id, {
      value: record.hasValue ? { kept: true } : null,
      revision: { wall_time_ms: record.wallTimeMs, counter: 0, device_id: 'a' },
    }]))
    expect(Object.keys(pruneTombstoneRecords(map, nowMs)).sort()).toEqual([...keep].sort())
  })
})

describe('synced preferences (section 11)', () => {
  describe('merge(local, server)', () => {
    for (const vector of fixture.syncedPrefs.merge) {
      it(vector.name, () => {
        expect(mergeSyncedPrefs(vector.local, vector.server)).toEqual(vector.expect)
      })
    }
  })

  describe('read', () => {
    for (const vector of fixture.syncedPrefs.read) {
      it(vector.name, () => {
        expect(readSyncedPref(vector.entries, vector.key)).toEqual(vector.expect)
      })
    }
  })

  describe('one-time move', () => {
    for (const vector of fixture.syncedPrefs.move) {
      it(vector.name, () => {
        expect(shouldMoveLocalPref(vector.key, vector.local, 'carrier' in vector)).toBe(vector.expectWrite)
      })
    }
  })
})

describe('task order (section 12)', () => {
  const tasks: OrderableTask[] = fixture.taskOrder.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    due_date: task.due,
    priority: task.priority,
    ...(task.position === undefined ? {} : { position: task.position }),
    created: task.created,
  }))

  describe('sort', () => {
    for (const vector of fixture.taskOrder.sort) {
      it(vector.order, () => {
        expect(sortTasksByOrder(tasks, vector.order).map((task) => task.id)).toEqual(vector.expect)
        // The result does not depend on the order the tasks arrive in.
        expect(sortTasksByOrder([...tasks].reverse(), vector.order).map((task) => task.id)).toEqual(vector.expect)
      })
    }
  })

  describe('resolve', () => {
    const parents = fixture.taskOrder.resolve.parents
    const parentOf = (id: number) => parents[String(id)]
    for (const vector of fixture.taskOrder.resolve.vectors) {
      it(vector.name, () => {
        for (const [projectId, order] of Object.entries(vector.expect)) {
          expect(resolveTaskOrder(Number(projectId), parentOf, vector.entries), `project ${projectId}`).toBe(order)
        }
      })
    }
  })

  describe('drag', () => {
    for (const vector of fixture.taskOrder.drag) {
      it(vector.order, () => {
        expect(tasks.filter((task) => canReorderTask(vector.order, task)).map((task) => task.id).sort((a, b) => a - b)).toEqual(vector.expect)
      })
    }
  })
})
