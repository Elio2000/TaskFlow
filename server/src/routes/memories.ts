import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()

export function memoriesRoutes(): Router {
  const router = Router()

  router.get('/', (req: Request, res: Response) => {
    const projectId = req.query.project_id as string
    if (!projectId) {
      return res.json(req.db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all())
    }
    res.json(req.db.prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY created_at DESC').all(projectId))
  })

  router.post('/', (req: Request, res: Response) => {
    const t = now()
    const id = uid()
    req.db.prepare('INSERT INTO memories VALUES (?,?,?,?,?)').run(id, req.body.project_id, req.body.content, req.body.source || 'user', t)
    res.status(201).json(req.db.prepare('SELECT * FROM memories WHERE id = ?').get(id))
  })

  router.delete('/:id', (req: Request, res: Response) => {
    req.db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id)
    res.json({ deleted: true })
  })

  return router
}
