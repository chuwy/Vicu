import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { UnsyncedDocuments } from '@/lib/vikunja-types'

export const UNSYNCED_DOCUMENTS_QUERY_KEY = ['unsynced-documents'] as const

/**
 * Custom-list and settings changes that have not reached the server (`lib/unsynced-documents.ts`).
 * Read again whenever either document's sync status changes: main sends a status after every
 * local change, sync step and discard.
 */
export function useUnsyncedDocuments() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: UNSYNCED_DOCUMENTS_QUERY_KEY }) }
    const offLists = api.onCustomListSyncStatus(refresh)
    const offPrefs = api.onSyncedPrefsStatus(refresh)
    return () => {
      offLists()
      offPrefs()
    }
  }, [queryClient])
  return useQuery<UnsyncedDocuments>({
    queryKey: UNSYNCED_DOCUMENTS_QUERY_KEY,
    queryFn: () => api.getUnsyncedDocuments(),
    staleTime: Infinity,
  })
}
