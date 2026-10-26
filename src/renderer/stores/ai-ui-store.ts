import { create } from 'zustand'

// Small pieces of the assistant's UI that several places open: "Make tasks from this" (the command
// palette, the composer's pasted text) and the consent sheet.

interface AiUiState {
  /** The text of "Make tasks from this", or null while the dialog is closed. */
  makeTasksText: string | null
  openMakeTasks: (text?: string) => void
  closeMakeTasks: () => void
}

export const useAiUiStore = create<AiUiState>((set) => ({
  makeTasksText: null,
  openMakeTasks: (text = '') => set({ makeTasksText: text }),
  closeMakeTasks: () => set({ makeTasksText: null }),
}))
