/**
 * The vocabulary hint (docs/ai-assistant-v1.md section 3.4): Whisper's initial prompt, built from
 * the names the user is likely to say, the same way in every app. Vectors: `speech.hintVectors`.
 */
import { SPEECH } from './contract'
import { compareLowercased } from './dictation'

export interface HintProject {
  title: string
  /** The Inbox project. */
  inbox?: boolean
  /** The user can write to it (absent: yes). */
  writable?: boolean
  archived?: boolean
}

const HAS_LETTER = /\p{L}/u

/** The initial prompt, or null when no name is usable (then no prompt is passed). */
export function vocabularyHint(projects: readonly HintProject[], labels: readonly string[], places: readonly string[]): string | null {
  const { max_chars: maxChars, max_name_chars: maxName, separator, end } = SPEECH.hint
  const inbox = projects.filter((project) => project.inbox === true).map((project) => project.title)
  const others = projects
    .filter((project) => project.inbox !== true && project.writable !== false && project.archived !== true)
    .map((project) => project.title)
    .sort(compareLowercased)
  const candidates = [...inbox, ...others, ...[...labels].sort(compareLowercased), ...[...places].sort(compareLowercased)]

  const taken: string[] = []
  const seen = new Set<string>()
  for (const raw of candidates) {
    const name = raw.trim()
    if (name === '' || !HAS_LETTER.test(name) || name.length > maxName) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if ([...taken, name].join(separator).length + end.length > maxChars) break
    seen.add(key)
    taken.push(name)
  }
  return taken.length > 0 ? taken.join(separator) + end : null
}
