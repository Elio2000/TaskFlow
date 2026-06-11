import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()

export function cycleRoutes(): Router {
  const router = Router()

  router.get('/', (req: Request, res: Response) => {
    const cycles = req.db.prepare('SELECT * FROM cycles ORDER BY start_date ASC').all()
    res.json(cycles)
  })

  router.post('/', (req: Request, res: Response) => {
    const id = uid()
    const t = now()
    req.db.prepare('INSERT INTO cycles VALUES (?,?,?,?,?,?,?)').run(
      id, req.body.name, req.body.description || '', req.body.start_date, req.body.end_date, t, t
    )
    res.status(201).json(req.db.prepare('SELECT * FROM cycles WHERE id = ?').get(id))
  })

  router.patch('/:id', (req: Request, res: Response) => {
    const t = now()
    const fields = ['name', 'description', 'start_date', 'end_date']
    const sets: string[] = ['updated_at = ?']
    const params: any[] = [t]
    for (const f of fields) {
      if (f in req.body) { sets.push(`${f} = ?`); params.push(req.body[f]) }
    }
    params.push(req.params.id)
    req.db.prepare(`UPDATE cycles SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    res.json(req.db.prepare('SELECT * FROM cycles WHERE id = ?').get(req.params.id))
  })

  router.delete('/:id', (req: Request, res: Response) => {
    req.db.prepare('DELETE FROM cycles WHERE id = ?').run(req.params.id)
    res.json({ deleted: true })
  })

  router.get('/:id/tasks', (req: Request, res: Response) => {
    const tasks = req.db.prepare(`
      SELECT t.* FROM tasks t
      INNER JOIN cycle_tasks ct ON ct.task_id = t.id
      WHERE ct.cycle_id = ?
      ORDER BY t.sort_order ASC, t.created_at ASC
    `).all(req.params.id)
    res.json(tasks)
  })

  router.post('/:id/tasks', (req: Request, res: Response) => {
    const t = now()
    req.db.prepare('INSERT OR IGNORE INTO cycle_tasks VALUES (?,?,?)').run(req.params.id, req.body.task_id, t)
    res.status(201).json({ added: true })
  })

  router.delete('/:id/tasks/:taskId', (req: Request, res: Response) => {
    req.db.prepare('DELETE FROM cycle_tasks WHERE cycle_id = ? AND task_id = ?').run(req.params.id, req.params.taskId)
    res.json({ removed: true })
  })

  return router
}
