import { describe, expect, it } from 'vitest'
import { discardDocumentsPrompt, stalledDocumentsLabel, unsyncedDocumentItems } from '../unsynced-documents'

const offline = { state: 'offline' as const, message: 'Network error' }

describe('unsynced custom-list and settings changes in the sync panel', () => {
  it('lists only the documents that have changes the server lacks, with where they stand', () => {
    expect(unsyncedDocumentItems(undefined)).toEqual([])
    expect(unsyncedDocumentItems({ customLists: null, preferences: null })).toEqual([])
    expect(unsyncedDocumentItems({ customLists: offline, preferences: { state: 'update_required', message: 'Update Vicu to sync preferences' } })).toEqual([
      { key: 'customLists', label: 'Custom list changes', note: 'Sent when the server can be reached.' },
      { key: 'preferences', label: 'Settings changes (the Inbox, the task order, location reminders)', note: 'Update Vicu to sync preferences' },
    ])
  })

  it('puts a sidebar label up only for changes that are stuck, not ones on their way', () => {
    expect(stalledDocumentsLabel({ customLists: { state: 'pending' }, preferences: { state: 'syncing' } })).toBeNull()
    expect(stalledDocumentsLabel({ customLists: offline, preferences: null })).toBe('Custom lists waiting')
    expect(stalledDocumentsLabel({ customLists: null, preferences: { state: 'error', message: 'x' } })).toBe('Settings waiting')
    expect(stalledDocumentsLabel({ customLists: offline, preferences: offline })).toBe('Lists and settings waiting')
  })

  it('says what a discard takes back', () => {
    const both = unsyncedDocumentItems({ customLists: offline, preferences: offline })
    expect(discardDocumentsPrompt(both)).toBe(
      'Discard the custom-list and settings changes that have not reached the server? Your custom lists and settings go back to what the server has.',
    )
    expect(discardDocumentsPrompt(both.slice(1))).toBe(
      'Discard the settings changes that have not reached the server? Your settings go back to what the server has.',
    )
  })
})
