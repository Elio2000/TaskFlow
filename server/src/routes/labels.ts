import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

export function labelRoutes(): Router {
  const router = Router()

  router.get('/', (req: Request, res: Response) => {
    res.json(req.db.prepare('SELECT * FROM labels').all())
  })

  router.get('/:id', (req: Request, res: Response) => {
    res.json(req.db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id) || null)
  })

  router.post('/', (req: Request, res: Response) => {
    const id = uid()
    req.db.prepare('INSERT INTO labels VALUES (?,?,?)').run(id, req.body.name, req.body.color || '#8a8a85')
    res.status(201).json(req.db.prepare('SELECT * FROM labels WHERE id = ?').get(id))
  })

  return router
}
