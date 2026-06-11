import { Router, Request, Response } from 'express'

export function settingsRoutes(): Router {
  const router = Router()

  router.get('/:key', (req: Request, res: Response) => {
    const setting = req.db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key) as any
    res.json({ key: req.params.key, value: setting?.value || null })
  })

  router.put('/:key', (req: Request, res: Response) => {
    const existing = req.db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key)
    if (existing) {
      req.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(req.body.value, req.params.key)
    } else {
      req.db.prepare('INSERT INTO settings VALUES (?,?)').run(req.params.key, req.body.value)
    }
    res.json({ key: req.params.key, value: req.body.value })
  })

  return router
}
