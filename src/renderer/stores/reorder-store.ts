import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'
import { DEFAULT_TASK_ORDER, type TaskOrderKey } from '../../shared/task-order'

interface SectionContext {
  viewId: number
  tasks: Task[]
  /** The section project's task order: which rows may be dragged and which anchor a drop. */
  order: TaskOrderKey
}

interface ReorderState {
  viewId: number | null
  orderedTasks: Task[]
  /** The task order of the list in `orderedTasks` (cross-app semantics 12.4). */
  order: TaskOrderKey
  sectionContexts: Map<number, SectionContext>
  setReorderContext: (viewId: number | null, tasks: Task[], order?: TaskOrderKey) => void
  setSectionReorderContext: (projectId: number, viewId: number, tasks: Task[], order?: TaskOrderKey) => void
  clearSectionContexts: () => void
}

export const useReorderStore = create<ReorderState>((set) => ({
  viewId: null,
  orderedTasks: [],
  order: DEFAULT_TASK_ORDER,
  sectionContexts: new Map(),
  setReorderContext: (viewId, orderedTasks, order = DEFAULT_TASK_ORDER) => set({ viewId, orderedTasks, order }),
  setSectionReorderContext: (projectId, viewId, tasks, order = DEFAULT_TASK_ORDER) =>
    set((state) => {
      const next = new Map(state.sectionContexts)
      next.set(projectId, { viewId, tasks, order })
      return { sectionContexts: next }
    }),
  clearSectionContexts: () => set({ sectionContexts: new Map() }),
}))
