import { describe, expect, it } from 'vitest'
import { orderSectionTasks, type SectionData } from '../use-project-sections'
import type { Project, Task } from '@/lib/vikunja-types'

const task = (id: number, title: string, position: number, due_date = '0001-01-01T00:00:00Z'): Task =>
  ({ id, title, position, due_date, priority: 0, project_id: 1 }) as Task

const section = (id: number, order: SectionData['order'], tasks: Task[], children: SectionData[] = []): SectionData => ({
  project: { id } as Project,
  tasks,
  viewId: 1,
  children,
  order,
})

describe('sections in their project task order (cross-app semantics 12)', () => {
  it('sorts each section, nested ones too, by its own order and leaves the default one as it is', () => {
    const defaultTasks = [task(1, 'b', 100), task(2, 'a', 200)]
    const sections = orderSectionTasks([
      section(10, 'title', [task(3, 'Zebra', 100), task(4, 'apple', 200)], [
        section(11, 'manual', [task(5, 'x', 300, '2026-10-08T21:59:59Z'), task(6, 'y', 100)]),
      ]),
      section(20, 'due_date_first', defaultTasks),
    ])
    expect(sections[0].tasks.map((t) => t.id)).toEqual([4, 3])
    expect(sections[0].children[0].tasks.map((t) => t.id)).toEqual([6, 5])
    expect(sections[1].tasks).toBe(defaultTasks)
  })
})
