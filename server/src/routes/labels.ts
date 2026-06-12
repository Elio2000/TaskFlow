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
    const name = (req.body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name required' })
    // Dedup: return existing label if same name exists
    const existing = req.db.prepare('SELECT * FROM labels WHERE name = ?').get(name) as any
    if (existing) return res.status(200).json(existing)
    const id = uid()
    req.db.prepare('INSERT INTO labels VALUES (?,?,?)').run(id, name, req.body.color || '#8a8a85')
    res.status(201).json(req.db.prepare('SELECT * FROM labels WHERE id = ?').get(id))
  })

  return router
}
