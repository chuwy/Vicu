/**
 * Two people ticking a shared routine at the same moment, against a real Vikunja server, with the
 * app's own `writeRoutineCarrier` (cross-app semantics 6.8). Skipped unless `VICU_LIVE_RACE` names
 * the ui-verify `.local` folder (credentials of two members of the routine's project) and
 * `VICU_LIVE_RACE_TASK` the carrier's task id; `VICU_LIVE_RACE_SERVER` defaults to the harness
 * server. It writes test occurrences into that carrier.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeRoutineCarrier, type RoutineStoreApi } from '../routine-store'
import { parseRoutineEnvelope, type JsonPatchOperation, type RoutineOccurrenceRecord } from '../routines'
import type { ApiResult, Task } from '../vikunja-types'

const local = process.env.VICU_LIVE_RACE
const taskId = Number(process.env.VICU_LIVE_RACE_TASK ?? 0)
const server = `${process.env.VICU_LIVE_RACE_SERVER ?? 'http://localhost:3456'}/api/v2`

async function login(file: string): Promise<{ token: string; me: number }> {
  const credentials = JSON.parse(readFileSync(join(local!, file), 'utf8'))
  const answer = await fetch(`${server}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password, long_token: true }),
  })
  const { token } = await answer.json()
  const me = await (await fetch(`${server}/user`, { headers: { Authorization: `Bearer ${token}` } })).json()
  return { token, me: me.id }
}

function apiFor(token: string): RoutineStoreApi {
  const call = async (method: string, path: string, body?: unknown, type = 'application/json') => {
    const answer = await fetch(`${server}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': type } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await answer.text()
    return answer.ok
      ? { success: true as const, data: text ? JSON.parse(text) : undefined }
      : { success: false as const, error: `HTTP ${answer.status}`, statusCode: answer.status }
  }
  const unsupported = async () => ({ success: false as const, error: 'not used' })
  return {
    ownUserId: async () => null,
    fetchTasks: unsupported,
    fetchTaskById: (id) => call('GET', `tasks/${id}`) as Promise<ApiResult<Task>>,
    createTask: unsupported,
    updateTask: unsupported,
    patchTaskJson: (id, operations: ReadonlyArray<JsonPatchOperation>) =>
      call('PATCH', `tasks/${id}`, operations, 'application/json-patch+json') as Promise<ApiResult<Task> & { statusCode?: number }>,
    deleteTask: unsupported,
  }
}

describe.skipIf(!local || !taskId)('live routine race', () => {
  it('two people ticking at the same moment both count', async () => {
    const people = await Promise.all(['credentials.json', 'credentials-uimaya.json'].map(login))
    const pairs = 20
    let lost = 0
    for (let i = 0; i < pairs; i += 1) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`
      const reads = await Promise.all(people.map(async ({ token, me }, index) => {
        const api = apiFor(token)
        const read = await api.fetchTaskById(taskId)
        if (!read.success) throw new Error(read.error)
        const payload = parseRoutineEnvelope(read.data.description).payload!
        const slot = payload.definition.slots[index % payload.definition.slots.length]
        const stamp = new Date().toISOString()
        const device = `live-race-desktop-${me}`
        const record: RoutineOccurrenceRecord = {
          key: `${payload.definition.id}:${date}:${slot.id}`,
          routineId: payload.definition.id,
          slotId: slot.id,
          scheduledDate: date,
          scheduledMinutes: slot.reminderMinutes,
          timeZoneId: 'Europe/Amsterdam',
          status: 'COMPLETED',
          loggedAt: stamp,
          modifiedAt: stamp,
          modifiedBy: device,
          note: '',
          loggedBy: { userId: me, deviceId: device },
        }
        return { api, carrier: { task: read.data, payload }, local: { ...payload, occurrences: { ...payload.occurrences, [record.key]: record } }, key: record.key }
      }))
      await Promise.all(reads.map(({ api, carrier, local: payload, key }) =>
        writeRoutineCarrier(api, carrier, payload, { today: '2026-10-24' }).then(() => key)))
      const stored = await apiFor(people[0].token).fetchTaskById(taskId)
      if (!stored.success) throw new Error(stored.error)
      const occurrences = parseRoutineEnvelope(stored.data.description).payload!.occurrences
      lost += reads.filter(({ key }) => !(key in occurrences)).length
    }
    console.log(`Live race: ${pairs} pairs, ${2 * pairs} writes, lost ${lost}`)
    expect(lost).toBe(0)
  }, 120_000)
})
