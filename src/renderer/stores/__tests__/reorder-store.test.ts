import { describe, expect, it } from 'vitest'
import { reorderContextOf, type SectionContext } from '../reorder-store'
import type { Task } from '@/lib/vikunja-types'

const task = (id: number): Task => ({ id, title: `t${id}`, position: id * 100, project_id: 1 }) as Task

function state(viewId: number | null, orderedTasks: Task[], sections: Array<[number, SectionContext]> = []) {
  return { viewId, orderedTasks, order: 'manual' as const, sectionContexts: new Map(sections) }
}

describe('reorderContextOf (the list a keyboard move happens in)', () => {
  it('finds the view list first, then a section', () => {
    const section: SectionContext = { viewId: 9, tasks: [task(3)], order: 'title' }
    const s = state(5, [task(1), task(2)], [[20, section]])
    expect(reorderContextOf(s, 2)).toEqual({ viewId: 5, tasks: s.orderedTasks, order: 'manual' })
    expect(reorderContextOf(s, 3)).toBe(section)
    expect(reorderContextOf(s, 4)).toBeNull()
  })

  it('skips the view list while it has no view id', () => {
    expect(reorderContextOf(state(null, [task(1)]), 1)).toBeNull()
  })
})
