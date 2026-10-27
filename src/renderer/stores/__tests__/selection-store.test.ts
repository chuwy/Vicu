import { beforeEach, describe, expect, it } from 'vitest'
import { useSelectionStore } from '../selection-store'

const store = () => useSelectionStore.getState()

describe('opened subtasks', () => {
  beforeEach(() => {
    useSelectionStore.setState({ expandedTaskId: null, focusedTaskId: null, openedSubtasks: [] })
  })

  it('opens a subtask from its parent card and remembers where it sits', () => {
    store().setExpandedTask(1)
    store().openSubtask(1, 2)

    expect(store().expandedTaskId).toBe(2)
    expect(store().focusedTaskId).toBe(2)
    expect(store().openedSubtasks).toEqual([{ parentId: 1, id: 2 }])
  })

  it('goes one level deeper from an opened subtask', () => {
    store().openSubtask(1, 2)
    store().openSubtask(2, 3)

    expect(store().expandedTaskId).toBe(3)
    expect(store().openedSubtasks).toEqual([{ parentId: 1, id: 2 }, { parentId: 2, id: 3 }])
  })

  it('drops the deeper levels when a sibling higher up is opened', () => {
    store().openSubtask(1, 2)
    store().openSubtask(2, 3)
    store().openSubtask(1, 4)

    expect(store().openedSubtasks).toEqual([{ parentId: 1, id: 4 }])
  })

  it('keeps the opened row when its card closes or opens again', () => {
    store().openSubtask(1, 2)
    store().collapseAll()
    expect(store().expandedTaskId).toBeNull()
    expect(store().openedSubtasks).toEqual([{ parentId: 1, id: 2 }])

    store().toggleExpandedTask(2)
    expect(store().expandedTaskId).toBe(2)
    expect(store().openedSubtasks).toEqual([{ parentId: 1, id: 2 }])
  })

  it('forgets the opened subtasks when another task opens', () => {
    store().openSubtask(1, 2)
    store().setExpandedTask(1)

    expect(store().expandedTaskId).toBe(1)
    expect(store().openedSubtasks).toEqual([])
  })
})
