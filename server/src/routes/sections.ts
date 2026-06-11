import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

export function sectionRoutes(): Router {
  const router = Router()

  router.get('/', (req: Request, res: Response) => {
    if (req.query.project_id) {
      res.json(req.db.prepare('SELECT * FROM sections WHERE project_id = ? ORDER BY sort_order ASC').all(req.query.project_id))
    } else {
      res.json(req.db.prepare('SELECT * FROM sections ORDER BY sort_order ASC').all())
    }
  })

  router.get('/:id', (req: Request, res: Response) => {
    res.json(req.db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id) || null)
  })

  router.post('/', (req: Request, res: Response) => {
    const id = uid()
    const count = (req.db.prepare('SELECT COUNT(*) as c FROM sections WHERE project_id = ?').get(req.body.project_id) as any).c
    req.db.prepare('INSERT INTO sections VALUES (?,?,?,?)').run(id, req.body.project_id, req.body.name, count)
    res.status(201).json(req.db.prepare('SELECT * FROM sections WHERE id = ?').get(id))
  })

  router.patch('/:id', (req: Request, res: Response) => {
    if (req.body.name) {
      req.db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(req.body.name, req.params.id)
    }
    res.json(req.db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id))
  })

  router.delete('/:id', (req: Request, res: Response) => {
    req.db.prepare("UPDATE tasks SET section_id = NULL WHERE section_id = ?").run(req.params.id)
    req.db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id)
    res.json({ deleted: true })
  })

  return router
}
