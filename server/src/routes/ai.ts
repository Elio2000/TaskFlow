import { Router, Request, Response } from 'express'

export function aiRoutes(): Router {
  const router = Router()

  router.post('/stream', async (req: Request, res: Response) => {
    const { message, project_id, conv_id } = req.body

    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    // Read config from env
    const apiKey = process.env.DEEPSEEK_API_KEY
    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
    const model = process.env.AI_PLANNER_MODEL || 'deepseek-chat'

    if (!apiKey) {
      return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' })
    }

    // Build system prompt
    let systemPrompt = '你是一个智能任务助手。用中文回复，简洁有力。'

    // Load agent rules from DB if available
    try {
      const agentRules = req.db.prepare("SELECT value FROM settings WHERE key = 'agent_rules'").get() as any
      if (agentRules?.value) {
        systemPrompt = agentRules.value
      }
    } catch {}

    // Load project context
    if (project_id) {
      try {
        const proj = req.db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id) as any
        if (proj) systemPrompt += `\n\n当前项目：${proj.name}`

        // Load memories
        const mems = req.db.prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY created_at DESC LIMIT 10').all(project_id) as any[]
        if (mems.length) {
          systemPrompt += '\n\n## 项目记忆\n' + mems.map((m: any) => `- ${m.content}`).join('\n')
        }

        // Load agents doc
        const doc = req.db.prepare('SELECT * FROM agents_docs WHERE project_id = ?').get(project_id) as any
        if (doc?.content) {
          systemPrompt += '\n\n## AGENTS.md\n' + doc.content
        }

        // Load recent tasks
        const tasks = req.db.prepare("SELECT * FROM tasks WHERE project_id = ? AND completed = 0 AND parent_id IS NULL ORDER BY sort_order ASC LIMIT 30").all(project_id) as any[]
        if (tasks.length) {
          systemPrompt += '\n\n## 当前任务列表\n' + tasks.map((t: any) =>
            `[${t.id.slice(-6)}] ${t.title}${t.due_date ? ' | 截止:' + t.due_date : ''}${t.priority < 4 ? ' | P' + t.priority : ''}`
          ).join('\n')
        }
      } catch {}
    }

    // Build conversation history if conv_id provided
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ]

    if (conv_id) {
      try {
        const history = req.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20').all(conv_id) as any[]
        for (const msg of history) {
          if (msg.role !== 'system') {
            messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content })
          }
        }
      } catch {}
    }

    messages.push({ role: 'user', content: message })

    // Call DeepSeek API with streaming
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      const thinkingType = process.env.AI_PLANNER_THINKING === 'enabled' ? 'enabled' : 'disabled'
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          thinking: { type: thinkingType },
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        let errMsg = `DeepSeek API error ${response.status}`
        try { const j = JSON.parse(errText); errMsg = j.error?.message || errMsg } catch {}
        res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`)
        res.end()
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let fullContent = ''
      let fullReasoning = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content
              res.write(`event: reasoning\ndata: ${JSON.stringify({ reasoning_content: delta.reasoning_content })}\n\n`)
            }
            if (delta?.content) {
              fullContent += delta.content
              res.write(`event: delta\ndata: ${JSON.stringify({ content: delta.content })}\n\n`)
            }
          } catch {}
        }
      }

      // Parse proposals from fullContent only
      let proposals = null
      let cleanContent = fullContent
      const propMatch = fullContent.match(/```proposals\s*([\s\S]*?)```/)
      if (propMatch) {
        try { proposals = JSON.parse(propMatch[1]) } catch {}
        cleanContent = fullContent.replace(/```proposals[\s\S]*?```/, '').trim()
      }

      res.write(`event: done\ndata: ${JSON.stringify({ content: cleanContent, reasoning_content: fullReasoning, proposals })}\n\n`)
      res.end()
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Unknown error' })}\n\n`)
      res.end()
    }
  })

  return router
}
