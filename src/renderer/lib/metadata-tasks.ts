import { isHiddenTask } from '../../shared/hidden-tasks'

/**
 * True for hidden tasks (custom-list, routine, archive, preferences carriers and any later kind):
 * they never render as user tasks (cross-app semantics section 10.1). One rule, in
 * `src/shared/hidden-tasks.ts`, for the renderer and the main process.
 */
export function hasVicuMetadataMarker(description?: string | null): boolean {
  return isHiddenTask(description)
}
