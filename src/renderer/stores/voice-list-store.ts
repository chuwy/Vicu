import { create } from 'zustand'
import type { VoiceListDefaults } from '@/lib/voice/voice-task'

// The composer defaults of the list on screen (docs/voice-input.md): the TaskList that shows a
// composer registers the `projectId` and `defaultDueDate` its view gives it, so a voice capture
// gives a new task the same defaults. Nothing registered (Search, Settings): the Inbox, no date.

interface VoiceListState {
  defaults: VoiceListDefaults | null
  owner: object | null
  register: (owner: object, defaults: VoiceListDefaults) => void
  /** Only the list that registered clears it (the next view may already have registered). */
  unregister: (owner: object) => void
}

export const useVoiceListStore = create<VoiceListState>((set, get) => ({
  defaults: null,
  owner: null,
  register: (owner, defaults) => set({ owner, defaults }),
  unregister: (owner) => {
    if (get().owner === owner) set({ owner: null, defaults: null })
  },
}))
