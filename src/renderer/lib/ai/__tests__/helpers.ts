import type { AiWorkspace } from '../workspace'
import type { Label, Project, Task } from '../../vikunja-types'

export function project(id: number, title: string, extra: Partial<Project> = {}): Project {
  return { id, title, description: '', parent_project_id: 0, is_archived: false, hex_color: '', position: id, created: '', updated: '', max_permission: 1, ...extra }
}

export function task(id: number, title: string, extra: Partial<Task> = {}): Task {
  return {
    id, title, description: '', done: false, done_at: '', due_date: '0001-01-01T00:00:00Z', start_date: '', end_date: '',
    priority: 0, project_id: 1, labels: [], reminders: [], created: '', updated: '', created_by: { id: 1, username: 'me' },
    identifier: '', position: id, bucket_id: 0, percent_done: 0, repeat_after: 0, repeat_mode: 0, hex_color: '', ...extra,
  }
}

export function label(id: number, title: string): Label {
  return { id, title, hex_color: '', created: '', updated: '' } as Label
}

export function workspace(extra: Partial<AiWorkspace> = {}): AiWorkspace {
  const projects = [
    project(1, 'Inbox'),
    project(12, 'Home'),
    project(5, 'Travel'),
    project(20, 'Lisbon trip', { parent_project_id: 5 }),
    project(30, 'Old', { is_archived: true }),
    project(40, 'Shared view', { max_permission: 0 }),
    project(50, 'Team'),
  ]
  return {
    projects,
    inboxProjectId: 1,
    labels: [label(3, 'errands'), label(4, 'phone')],
    places: [{ id: 'p-home', name: 'Home' }],
    customLists: [],
    me: { id: 1, username: 'me', name: 'Me' },
    access: (id) => (id === 50
      ? { shared: true, members: [], permission: 1 }
      : id === 40 ? { shared: true, members: [], permission: 0 } : { shared: false, members: [], permission: 1 }),
    ...extra,
  }
}
