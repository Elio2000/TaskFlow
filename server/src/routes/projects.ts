import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()

export function projectRoutes(): Router {
  const router = Router()

  router.get('/', (req: Request, res: Response) => {
    const projects = req.db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY sort_order ASC').all()
    res.json(projects)
  })

  router.get('/:id', (req: Request, res: Response) => {
    const project = req.db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    res.json(project || null)
  })

  router.post('/', (req: Request, res: Response) => {
    const id = uid()
    const t = now()
    const body = req.body
    const count = (req.db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c

    req.db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(
      id, body.name, body.color || '#8a8a85', body.view_mode || 'list',
      body.favorite ?? 0, count, 0, t
    )
    const project = req.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    res.status(201).json(project)
  })

  router.patch('/:id', (req: Request, res: Response) => {
    const body = req.body
    const sets: string[] = []
    const params: any[] = []
    const fields = ['name', 'color', 'view_mode', 'favorite', 'archived']
    for (const f of fields) {
      if (f in body) { sets.push(`${f} = ?`); params.push(body[f]) }
    }
    if (sets.length === 0) return res.json(req.db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id))
    params.push(req.params.id)
    req.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    res.json(req.db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id))
  })

  router.delete('/:id', (req: Request, res: Response) => {
    if (req.params.id === 'inbox') return res.status(400).json({ error: 'Cannot delete inbox' })
    req.db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id)
    res.json({ deleted: true })
  })

  return router
}
