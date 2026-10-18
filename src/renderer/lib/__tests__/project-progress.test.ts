import { describe, expect, it } from 'vitest'
import { toggleCollapsed } from '../../hooks/use-sidebar-collapsed'
import { openCountsByProject, openTaskCountLabel, progressLabel, projectProgress, shownOpenCount } from '../project-progress'

describe('openCountsByProject', () => {
  it('counts open tasks per project and ignores done ones', () => {
    const counts = openCountsByProject([
      { project_id: 1, done: false },
      { project_id: 1, done: false },
      { project_id: 1, done: true },
      { project_id: 2, done: false },
      { project_id: 3, done: true },
    ])
    expect([...counts.entries()]).toEqual([[1, 2], [2, 1]])
  })
})

describe('projectProgress', () => {
  it('is the share of done tasks among all of the project', () => {
    expect(projectProgress(3, 9)).toEqual({ done: 3, total: 12, fraction: 0.25 })
    expect(projectProgress(0, 4)).toEqual({ done: 0, total: 4, fraction: 0 })
    expect(projectProgress(5, 0)).toEqual({ done: 5, total: 5, fraction: 1 })
  })

  it('is nothing for an empty project or a count that is not known', () => {
    expect(projectProgress(0, 0)).toBeNull()
    expect(projectProgress(undefined, 3)).toBeNull()
    expect(projectProgress(3, undefined)).toBeNull()
    expect(projectProgress(-1, 3)).toBeNull()
    expect(projectProgress(Number.NaN, 3)).toBeNull()
  })

  it('reads as plain words', () => {
    expect(progressLabel({ done: 3, total: 8, fraction: 3 / 8 })).toBe('3 of 8 done')
  })
})

describe('shownOpenCount', () => {
  const counts = new Map([[1, 3], [2, 0]])

  it('is the open tasks of the project', () => {
    expect(shownOpenCount(counts, 1)).toBe(3)
  })

  it('is nothing while loading and for a project without open tasks', () => {
    expect(shownOpenCount(null, 1)).toBeNull()
    expect(shownOpenCount(counts, 2)).toBeNull()
    expect(shownOpenCount(counts, 9)).toBeNull()
  })

  it('reads as plain words', () => {
    expect(openTaskCountLabel(1)).toBe('1 open task')
    expect(openTaskCountLabel(3)).toBe('3 open tasks')
  })
})

describe('toggleCollapsed', () => {
  it('adds an id once, keeping the list ascending', () => {
    expect(toggleCollapsed([4, 9], 6, true)).toEqual([4, 6, 9])
    expect(toggleCollapsed([4, 9], 9, true)).toEqual([4, 9])
  })

  it('removes an id when it is expanded again', () => {
    expect(toggleCollapsed([4, 9], 4, false)).toEqual([9])
    expect(toggleCollapsed([], 4, false)).toEqual([])
  })
})
