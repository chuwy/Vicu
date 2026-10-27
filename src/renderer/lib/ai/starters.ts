import { ASK_STARTERS, type StarterKind } from '../../../shared/ai/contract'

/**
 * The kind of list Ask was opened from, for its starters (docs/ai-assistant-v1.md section 5.7):
 * Today, Upcoming, the Inbox (its own view or the Inbox project), another project, or anything else.
 */
export function starterKind(pathname: string, inboxProjectId: number): StarterKind {
  if (pathname === '/today') return 'today'
  if (pathname === '/upcoming') return 'upcoming'
  if (pathname === '/inbox' || pathname === '/' || pathname === '') return 'inbox'
  const project = /^\/project\/(\d+)/.exec(pathname)
  if (project) return Number(project[1]) === inboxProjectId ? 'inbox' : 'project'
  return 'other'
}

/** The starters for a list, exactly as the fixture writes them (one is sent as written). */
export function startersFor(pathname: string, inboxProjectId: number): readonly string[] {
  return ASK_STARTERS[starterKind(pathname, inboxProjectId)]
}
