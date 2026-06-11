import { Router, Request, Response } from 'express'

const now = () => new Date().toISOString()

export function agentsDocRoutes(): Router {
  const router = Router()

  router.get('/:projectId', (req: Request, res: Response) => {
    const doc = req.db.prepare('SELECT * FROM agents_docs WHERE project_id = ?').get(req.params.projectId) as any
    res.json({ content: doc?.content || '', updated_at: doc?.updated_at || null })
  })

  router.put('/:projectId', (req: Request, res: Response) => {
    const t = now()
    const existing = req.db.prepare('SELECT * FROM agents_docs WHERE project_id = ?').get(req.params.projectId)
    if (existing) {
      req.db.prepare('UPDATE agents_docs SET content = ?, updated_at = ? WHERE project_id = ?').run(req.body.content, t, req.params.projectId)
    } else {
      req.db.prepare('INSERT INTO agents_docs VALUES (?,?,?)').run(req.params.projectId, req.body.content, t)
    }
    res.json({ content: req.body.content, updated_at: t })
  })

  return router
}
