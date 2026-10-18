import { useState } from 'react'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOfflineStore } from '@/stores/offline-store'
import { useUnsyncedDocuments } from '@/hooks/use-unsynced-documents'
import { stalledDocumentsLabel } from '@/lib/unsynced-documents'
import { SyncPanel } from './SyncPanel'

/** What the status button says; pure so it can be tested. */
export function syncStatusLabel(counts: { pending: number; failed: number }, authProblem: boolean, documents?: string | null): string {
  const parts: string[] = []
  if (authProblem) parts.push('Sign in needed')
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.pending > 0) parts.push(`${counts.pending} waiting`)
  if (documents) parts.push(documents)
  return parts.join(' · ')
}

/**
 * Sidebar indicator for offline changes: how many are waiting, how many failed, whether the
 * session needs a sign-in, and custom-list or settings changes that cannot reach the server.
 * Hidden when everything is synced; opens the sync panel.
 */
export function SyncStatusButton() {
  const counts = useOfflineStore((s) => s.counts)
  const replaying = useOfflineStore((s) => s.replaying)
  const authProblem = useOfflineStore((s) => s.authProblem)
  const { data: documents } = useUnsyncedDocuments()
  const [open, setOpen] = useState(false)

  const documentsLabel = stalledDocumentsLabel(documents)
  const needsAttention = counts.failed > 0 || authProblem !== null
  const visible = needsAttention || counts.pending > 0 || documentsLabel !== null

  return (
    <>
      {visible && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'mb-1 flex h-7 w-full items-center gap-2 rounded-control px-2.5 text-xs transition-colors hover:bg-[var(--bg-hover)]',
            needsAttention ? 'text-danger' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
          title="Offline changes: click to review"
        >
          {needsAttention ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          ) : replaying ? (
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.8} />
          ) : (
            <CloudOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          )}
          <span className="truncate">{syncStatusLabel(counts, authProblem !== null, documentsLabel)}</span>
        </button>
      )}
      {open && <SyncPanel onClose={() => setOpen(false)} />}
    </>
  )
}
