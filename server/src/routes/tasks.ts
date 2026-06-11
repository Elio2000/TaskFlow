import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()

export function taskRoutes(): Router {
  const router = Router()

  // GET /api/tasks
  router.get('/', (req: Request, res: Response) => {
    let sql = 'SELECT * FROM tasks WHERE 1=1'
    const params: any[] = []

    if (req.query.project_id) { sql += ' AND project_id = ?'; params.push(req.query.project_id) }
    if (req.query.section_id) { sql += ' AND section_id = ?'; params.push(req.query.section_id) }
    if (req.query.due_date) { sql += ' AND due_date = ?'; params.push(req.query.due_date) }
    if (req.query.parent_id !== undefined) {
      sql += ' AND parent_id ' + (req.query.parent_id ? '= ?' : 'IS NULL')
      if (req.query.parent_id) params.push(req.query.parent_id)
    }
    if (req.query.completed !== undefined) {
      sql += ' AND completed = ?'
      params.push(req.query.completed === '1' ? 1 : 0)
    }

    sql += ' ORDER BY sort_order ASC, created_at ASC'
    const tasks = req.db.prepare(sql).all(...params)
    res.json(tasks)
  })

  // POST /api/tasks
  router.post('/', (req: Request, res: Response) => {
    const id = uid()
    const t = now()
    const body = req.body

    req.db.prepare(`INSERT INTO tasks (id,project_id,section_id,parent_id,title,description,start_date,due_date,due_time,end_time,repeat,priority,labels,reminder,completed,completed_at,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      body.project_id || 'inbox',
      body.section_id || null,
      body.parent_id || null,
      body.title || '',
      body.description || '',
      body.start_date || null,
      body.due_date || null,
      body.due_time || null,
      body.end_time || null,
      body.repeat || null,
      body.priority ?? 4,
      typeof body.labels === 'string' ? body.labels : JSON.stringify(body.labels || []),
      body.reminder || null,
      body.completed ?? 0,
      null,
      body.sort_order ?? 1e6,
      t, t
    )

    const task = req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    res.status(201).json(task)
  })

  // PATCH /api/tasks/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const body = req.body
    const sets: string[] = ['updated_at = ?']
    const params: any[] = [now()]

    const fields = ['project_id', 'section_id', 'parent_id', 'title', 'description', 'start_date', 'due_date', 'due_time', 'end_time', 'repeat', 'priority', 'labels', 'reminder', 'completed', 'completed_at', 'sort_order']
    for (const f of fields) {
      if (f in body) {
        sets.push(`${f} = ?`)
        params.push(f === 'labels' ? JSON.stringify(body[f]) : body[f])
      }
    }

    if (sets.length === 1) {
      return res.json(req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id))
    }

    params.push(req.params.id)
    req.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    const task = req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
    res.json(task)
  })

  // DELETE /api/tasks/:id
  router.delete('/:id', (req: Request, res: Response) => {
    req.db.prepare('DELETE FROM tasks WHERE id = ? OR parent_id = ?').run(req.params.id, req.params.id)
    res.json({ deleted: true })
  })

  // PATCH /api/tasks/:id/toggle
  router.patch('/:id/toggle', (req: Request, res: Response) => {
    const task = req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any
    if (!task) return res.status(404).json({ error: 'Task not found' })

    if (!task.completed && task.repeat && task.due_date) {
      const due = new Date(task.due_date + 'T00:00:00')
      if (task.repeat === 'daily') due.setDate(due.getDate() + 1)
      else if (task.repeat === 'weekly') due.setDate(due.getDate() + 7)
      else if (task.repeat === 'monthly') due.setMonth(due.getMonth() + 1)
      req.db.prepare('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?').run(due.toISOString().slice(0, 10), now(), req.params.id)
    } else {
      const completed = task.completed ? 0 : 1
      const completedAt = completed ? now() : null
      req.db.prepare('UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(completed, completedAt, now(), req.params.id)
    }
    const updated = req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
    res.json(updated)
  })

  return router
}
