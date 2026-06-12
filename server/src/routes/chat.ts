import { Router, Request, Response } from 'express'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()

export function chatRoutes(): Router {
  const router = Router()

  // GET /conversations?project_id=
  router.get('/conversations', (req: Request, res: Response) => {
    const projectId = req.query.project_id as string
    if (!projectId) return res.json([])
    const convs = req.db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
    res.json(convs)
  })

  // POST /conversations
  router.post('/conversations', (req: Request, res: Response) => {
    const id = uid()
    const t = now()
    const projectId = req.body.project_id || 'inbox'
    // Verify project exists, fallback to inbox
    const proj = req.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    req.db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?)').run(
      id, proj ? projectId : 'inbox', req.body.title || 'New Conversation', null, t, t
    )
    res.status(201).json(req.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id))
  })

  // GET /conversations/:id/messages
  router.get('/conversations/:id/messages', (req: Request, res: Response) => {
    const msgs = req.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id)
    res.json(msgs)
  })

  // POST /conversations/:id/messages
  router.post('/conversations/:id/messages', (req: Request, res: Response) => {
    const t = now()
    const id = uid()
    req.db.prepare('INSERT INTO messages (id,conversation_id,role,content,refs,proposals,proposals_applied,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      id, req.params.id, req.body.role, req.body.content || '',
      JSON.stringify(req.body.refs || []), req.body.proposals ? JSON.stringify(req.body.proposals) : null,
      req.body.proposals_applied ?? 0, t
    )
    req.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, req.params.id)
    res.status(201).json(req.db.prepare('SELECT * FROM messages WHERE id = ?').get(id))
  })

  // POST /conversations/:id/clear
  router.post('/conversations/:id/clear', (req: Request, res: Response) => {
    req.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id)
    res.json({ cleared: true })
  })

  // PATCH /messages/:id
  router.patch('/messages/:id', (req: Request, res: Response) => {
    const body = req.body
    const sets: string[] = []
    const params: any[] = []
    if ('proposals_applied' in body) { sets.push('proposals_applied = ?'); params.push(body.proposals_applied) }
    if ('proposals' in body) { sets.push('proposals = ?'); params.push(JSON.stringify(body.proposals)) }
    if (sets.length === 0) return res.json(req.db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id))
    params.push(req.params.id)
    req.db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    res.json(req.db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id))
  })

  return router
}
