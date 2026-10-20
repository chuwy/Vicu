import { join } from 'path'
import type { ApiResult } from './api-result'
import { sanitizeAttachmentFileName } from './attachment-safety'

export interface SaveAttachmentDeps {
  /** Asks where to save, starting at [defaultPath]; null when the user cancels. */
  chooseFile(defaultPath: string): Promise<string | null>
  /** The attachment's bytes from the server. */
  download(): Promise<ApiResult<Buffer>>
  writeFile(filePath: string, data: Buffer): Promise<void>
}

export interface SavedAttachment {
  saved: boolean
  /** Where the file went, when it was saved. */
  path?: string
}

/**
 * "Save" on an attachment: asks where to put it (in [startDirectory], under its own name made safe
 * for the file system), then downloads it and writes it there. The download only starts once a
 * place is chosen, so cancelling costs nothing.
 */
export async function saveAttachment(
  fileName: string,
  attachmentId: number,
  startDirectory: string,
  deps: SaveAttachmentDeps
): Promise<ApiResult<SavedAttachment>> {
  const safeName = sanitizeAttachmentFileName(fileName, `attachment-${attachmentId}`)
  const target = await deps.chooseFile(join(startDirectory, safeName))
  if (!target) return { success: true, data: { saved: false } }

  const result = await deps.download()
  if (!result.success) return result
  try {
    await deps.writeFile(target, result.data)
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Could not save the file' }
  }
  return { success: true, data: { saved: true, path: target } }
}
