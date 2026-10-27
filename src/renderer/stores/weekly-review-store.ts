import { create } from 'zustand'
import type { WeeklyStepId } from '../../shared/guided'

/**
 * The weekly review in progress (docs/cross-app-semantics-v1.md section 14.7): which steps are done
 * and what each session changed, kept while the person goes into a session and comes back. A run
 * belongs to one local day; Finish (or a new day) starts over.
 */
interface WeeklyReviewState {
  /** The local day this run started, or null when none runs. */
  day: string | null
  done: ReadonlySet<WeeklyStepId>
  /** What each finished session changed, in the order they finished. */
  results: ReadonlyArray<{ step: WeeklyStepId; text: string }>
  /** Starts a run for `today` unless one runs for that day already. */
  begin: (today: string) => void
  markDone: (step: WeeklyStepId, result?: string) => void
  markOpen: (step: WeeklyStepId) => void
  reset: () => void
}

export const useWeeklyReviewStore = create<WeeklyReviewState>((set) => ({
  day: null,
  done: new Set(),
  results: [],
  begin: (today) => set((state) => (state.day === today ? state : { day: today, done: new Set(), results: [] })),
  markDone: (step, result) => set((state) => ({
    done: new Set(state.done).add(step),
    results: result ? [...state.results.filter((entry) => entry.step !== step), { step, text: result }] : state.results,
  })),
  markOpen: (step) => set((state) => {
    const done = new Set(state.done)
    done.delete(step)
    return { done }
  }),
  reset: () => set({ day: null, done: new Set(), results: [] }),
}))
