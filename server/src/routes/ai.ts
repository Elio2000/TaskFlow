import { Router, Request, Response } from 'express'

// Task-operation protocol — appended to every system prompt so the model knows
// the exact ```proposals``` block format that the client (AIPanel.applyProposals)
// and server (stream parser) expect. Without this, the model never emits proposals
// and "应用全部" can never create tasks.
const PROPOSAL_PROTOCOL = `

## 任务操作协议（重要）
当用户意图是创建 / 修改 / 完成 / 删除任务时，先用一两句话自然回复，然后在消息**末尾**附上一个 proposals 代码块（三个反引号加 proposals 语言标记），块内为 JSON 数组，每个元素是一个操作：
- 创建：{"op":"create","title":"任务标题","due_date":"YYYY-MM-DD","due_time":"HH:MM","priority":1,"description":"可选描述"}
- 修改：{"op":"update","task_id":"完整任务ID","title":"新标题","due_date":"YYYY-MM-DD"}
- 完成：{"op":"complete","task_id":"完整任务ID"}
- 删除：{"op":"delete","task_id":"完整任务ID"}
规则：due_date / due_time / description 等字段按需省略；priority 取 1-4，数字越小越重要，默认 4；task_id 必须使用「当前任务列表」中方括号内的完整 ID；仅在确有任务增删改需求时才输出该代码块，纯咨询或闲聊不要输出。
示例：
好的，已为你拆解：
\`\`\`proposals
[{"op":"create","title":"复习线性代数第3章","due_date":"2026-06-15","due_time":"14:00","priority":2}]
\`\`\``

// Clarifying-question protocol — lets the AI behave like a real assistant: when the
// user wants to plan/create tasks but key details are ambiguous (time of day, the
// person/object, online vs offline, duration, deadline…), it asks a few option-based
// questions FIRST instead of guessing. Mirrors PROPOSAL_PROTOCOL: the model emits a
// ```questions``` block, the server parses it into the `done` event, and the client
// renders a QuestionCard. The user picks options, which compose into a follow-up
// message that then yields accurate proposals.
const QUESTION_PROTOCOL = `

## 智能反问协议（重要）
当用户想创建 / 安排任务，但**关键信息不明确**（例如：具体时间点、对象是谁、线上还是线下、时长、截止日期等），不要自己瞎猜、也不要在同一条里直接给 proposals。请**先反问澄清**：在消息末尾附上一个 questions 代码块（三个反引号加 questions 语言标记），块内为 JSON 数组，每项为一个带选项的问题：
- 格式：{"q":"问题文本","options":["选项1","选项2","选项3"]}
- 每题 2-4 个选项；**不要**自己加「其他」，前端会自动补一个「其他」自由输入框。
- 一次最多问 1-3 个最关键的问题，别问太多。
判断标准：
- 信息**已足够明确**（如「明天下午3点开会1小时」时间对象都清楚）→ 直接给 proposals，**不要**反问。
- 信息**模糊**（如「帮我安排健身」「给朋友买礼物」没说时间/对象/方式）→ 先给 questions，**这一条不要**同时给 proposals。
示例（用户说"帮我安排健身和给朋友买礼物"）：
我先确认几个细节，好帮你安排得更准：
\`\`\`questions
[{"q":"你一般什么时间段健身？","options":["早上","中午","晚上"]},{"q":"给哪位朋友买礼物？","options":["最好的朋友","普通朋友","家人"]},{"q":"打算线上买还是线下买？","options":["线上","线下"]}]
\`\`\``

export function aiRoutes(): Router {
  const router = Router()

  router.post('/stream', async (req: Request, res: Response) => {
    const { message, project_id, conv_id } = req.body

    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    // Read config from env
    const apiKey = req.body.apiKey  // BYOK-only: key must be supplied per request; no server fallback key
    // BYOK provider is chosen on the client; it sends the OpenAI-compatible baseUrl per request.
    // Server stays provider-agnostic: just trust baseUrl (fallback to env/DeepSeek), strip trailing slash.
    const baseUrl = (req.body.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
    const model = req.body.model || process.env.AI_PLANNER_MODEL || 'deepseek-chat'

    if (!apiKey) {
      return res.status(400).json({ error: '请在 AI 设置中填写你的 DeepSeek API Key（本应用仅支持自带 Key）' })
    }

    // Build system prompt
    let systemPrompt = '你是 TaskFlow 的 AI 助手——一个专注「任务规划与时间分配」的智能体。你的职责：把用户的目标拆成可执行的任务、安排合理的时间与截止日期、识别冲突与遗漏。用中文回复，简洁有力，多给可直接采纳的具体建议。'

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
        const mems = req.db.prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(project_id) as any[]
        if (mems.length) {
          systemPrompt += '\n\n## 项目记忆\n' + mems.map((m: any) => `- ${m.content}`).join('\n')
        }

        // Load agents doc
        const doc = req.db.prepare('SELECT * FROM agents_docs WHERE project_id = ?').get(project_id) as any
        if (doc?.content) {
          systemPrompt += '\n\n## AGENTS.md\n' + doc.content
        }

        // Load tasks (incomplete first) with status / due / notes / subtasks so the AI
        // can plan time and spot gaps across the whole project.
        const tasks = req.db.prepare("SELECT * FROM tasks WHERE project_id = ? AND parent_id IS NULL ORDER BY completed ASC, sort_order ASC LIMIT 80").all(project_id) as any[]
        if (tasks.length) {
          systemPrompt += '\n\n## 项目任务列表（含状态/截止/备注/子任务）\n' + tasks.map((t: any) => {
            const status = t.completed ? '[已完成]' : '[未完成]'
            const due = t.due_date ? ` | 截止:${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : ''
            const pri = t.priority < 4 ? ` | P${t.priority}` : ''
            const desc = t.description ? ` | 备注:${String(t.description).replace(/\s+/g, ' ').slice(0, 120)}` : ''
            const subs = req.db.prepare("SELECT title, completed FROM tasks WHERE parent_id = ? LIMIT 20").all(t.id) as any[]
            const subStr = subs.length ? ` | 子任务:${subs.map((s: any) => (s.completed ? '✓' : '○') + s.title).join('、')}` : ''
            return `[${t.id}] ${status} ${t.title}${due}${pri}${desc}${subStr}`
          }).join('\n')
        }
      } catch {}
    }

    // Inject current date + task-operation protocol — always, even if agent_rules
    // overrode the base prompt. The proposals format is a system contract, not a tweak.
    const now = new Date()
    const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    systemPrompt += `\n\n## 当前时间\n今天是 ${dateStr}（周${wd}）。所有相对日期（今天/明天/本周等）以此为基准。`
    systemPrompt += PROPOSAL_PROTOCOL
    systemPrompt += QUESTION_PROTOCOL

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
      // `thinking` is a DeepSeek-specific param; other OpenAI-compatible providers (Kimi/Qwen/
      // Ollama/…) reject unknown fields, so omit it entirely unless explicitly enabled via env.
      const wantThinking = process.env.AI_PLANNER_THINKING === 'enabled'
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
          ...(wantThinking ? { thinking: { type: 'enabled' } } : {}),
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

      // Parse proposals + clarifying questions from fullContent
      let proposals = null
      let questions = null
      let cleanContent = fullContent
      const propMatch = fullContent.match(/```proposals\s*([\s\S]*?)```/)
      if (propMatch) {
        try { proposals = JSON.parse(propMatch[1]) } catch {}
        cleanContent = cleanContent.replace(/```proposals[\s\S]*?```/, '').trim()
      }
      const qMatch = fullContent.match(/```questions\s*([\s\S]*?)```/)
      if (qMatch) {
        try { questions = JSON.parse(qMatch[1]) } catch {}
        cleanContent = cleanContent.replace(/```questions[\s\S]*?```/, '').trim()
      }

      res.write(`event: done\ndata: ${JSON.stringify({ content: cleanContent, reasoning_content: fullReasoning, proposals, questions })}\n\n`)
      res.end()
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Unknown error' })}\n\n`)
      res.end()
    }
  })

  return router
}
