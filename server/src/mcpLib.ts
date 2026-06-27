/* Pure helpers for the TaskFlow MCP server (no I/O) — unit-tested in tests/mcp.test.mjs.
   Kept dependency-free so the test runner (node --test, native TS strip) can import it. */

export interface ProjectLike { id: string; name: string }

export interface TaskLike {
  id: string
  title: string
  project_id: string
  parent_id?: string | null
  due_date?: string | null
  due_time?: string | null
  completed: number
  priority: number
}

export type TaskFilter = 'today' | 'upcoming' | 'overdue' | 'inbox' | 'all'

/** Resolve a project name OR id to a project id (case-insensitive name match). Null if not found. */
export function resolveProjectId(projects: ProjectLike[], nameOrId: string | undefined | null): string | null {
  if (!nameOrId) return null
  if (projects.some(p => p.id === nameOrId)) return nameOrId
  const lc = nameOrId.trim().toLowerCase()
  const byName = projects.find(p => p.name.trim().toLowerCase() === lc)
  return byName ? byName.id : null
}

/** Filter tasks by a named filter. `today` is an ISO YYYY-MM-DD string; dates compare lexically.
   Always excludes subtasks (parent_id set). Excludes completed unless includeCompleted. */
export function filterTasks<T extends TaskLike>(
  tasks: T[],
  opts: { filter?: TaskFilter; projectId?: string | null; includeCompleted?: boolean },
  today: string,
): T[] {
  const { filter = 'all', projectId = null, includeCompleted = false } = opts
  return tasks.filter(t => {
    if (t.parent_id) return false
    if (!includeCompleted && t.completed) return false
    if (projectId && t.project_id !== projectId) return false
    switch (filter) {
      case 'today': return t.due_date === today
      case 'overdue': return !!t.due_date && t.due_date < today && !t.completed
      case 'upcoming': return !!t.due_date && t.due_date >= today
      case 'inbox': return t.project_id === 'inbox'
      default: return true // 'all'
    }
  })
}

/** One-line summary of a task for the agent to read back. */
export function formatTask(t: TaskLike, projectName?: string): string {
  const status = t.completed ? '✓' : '○'
  const proj = projectName ? ` [${projectName}]` : ''
  const due = t.due_date ? ` 📅${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : ''
  const pri = t.priority < 4 ? ` P${t.priority}` : ''
  return `${status} ${t.title}${proj}${due}${pri} (id:${t.id})`
}
