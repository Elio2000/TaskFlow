/* TaskFlow MCP server (stdio transport).

   A thin wrapper over the TaskFlow REST API so any MCP client (e.g. Hermes Agent) can
   manage tasks from Telegram/Slack/etc. Same-machine setup: it talks to the running
   TaskFlow server at http://localhost:3001/api by default (override with TASKFLOW_API).

   IMPORTANT: stdout is reserved for the MCP JSON-RPC protocol — only ever log to stderr. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolveProjectId, filterTasks, formatTask, type TaskFilter } from './mcpLib.js'
import { formatProposalLine, formatQuestionLines, type Proposal } from './planLib.js'

const API = (process.env.TASKFLOW_API || 'http://localhost:3001/api').replace(/\/+$/, '')
const log = (...a: unknown[]) => console.error('[taskflow-mcp]', ...a)

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...init })
  } catch (e: any) {
    throw new Error(`无法连接 TaskFlow（${API}）。请确认 TaskFlow 已运行（npm start，端口 3001）。原始错误：${e?.message || e}`)
  }
  if (!res.ok) {
    const txt = (await res.text().catch(() => '')) || res.statusText
    // REST 错误体统一是 { error: "中文提示" }，直接把提示透出，别让调用方看到原始 JSON
    let msg = txt
    try { msg = JSON.parse(txt).error || txt } catch {}
    throw new Error(`TaskFlow API ${res.status}: ${msg}`)
  }
  if (res.status === 204) return null
  const txt = await res.text()
  return txt ? JSON.parse(txt) : null
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const server = new McpServer({ name: 'taskflow', version: '1.0.0' })

server.registerTool('list_tasks', {
  title: '列出任务',
  description: '查询 TaskFlow 任务。filter：today=今天到期 / upcoming=今后到期 / overdue=逾期未完成 / inbox=收件箱 / all=全部（默认）。可选 project（项目名或 id）。默认不含已完成任务。',
  inputSchema: {
    filter: z.enum(['today', 'upcoming', 'overdue', 'inbox', 'all']).optional(),
    project: z.string().optional(),
    include_completed: z.boolean().optional(),
  },
}, async ({ filter, project, include_completed }) => {
  try {
    const [tasks, projects] = await Promise.all([apiFetch('/tasks'), apiFetch('/projects')])
    let projectId: string | null = null
    if (project) {
      projectId = resolveProjectId(projects, project)
      if (!projectId) return fail(`找不到项目「${project}」。现有项目：${projects.map((p: any) => p.name).join('、')}`)
    }
    const nameOf = (id: string) => projects.find((p: any) => p.id === id)?.name || id
    const list = filterTasks(tasks, { filter: filter as TaskFilter, projectId, includeCompleted: include_completed }, todayISO())
      .sort((a: any, b: any) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99'))
    if (!list.length) return ok('（没有匹配的任务）')
    return ok(list.map((t: any) => formatTask(t, nameOf(t.project_id))).join('\n'))
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('create_task', {
  title: '创建任务',
  description: '在 TaskFlow 创建任务。仅 title 必填。due_date 用绝对日期 YYYY-MM-DD（相对日期如“明天”请先自行折算）。project 传项目名或 id，默认收件箱。priority：1=最高…4=最低。',
  inputSchema: {
    title: z.string(),
    project: z.string().optional(),
    due_date: z.string().optional(),
    due_time: z.string().optional(),
    priority: z.number().int().min(1).max(4).optional(),
    description: z.string().optional(),
    in_sprint: z.boolean().optional(),
  },
}, async ({ title, project, due_date, due_time, priority, description, in_sprint }) => {
  try {
    let project_id = 'inbox'
    if (project) {
      const projects = await apiFetch('/projects')
      const rid = resolveProjectId(projects, project)
      if (!rid) return fail(`找不到项目「${project}」。现有项目：${projects.map((p: any) => p.name).join('、')}`)
      project_id = rid
    }
    const body: any = { title, project_id }
    if (due_date) body.due_date = due_date
    if (due_time) body.due_time = due_time
    if (priority != null) body.priority = priority
    if (description) body.description = description
    if (in_sprint) body.in_sprint = 1
    const t = await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) })
    return ok(`已创建任务：${formatTask(t)}`)
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('update_task', {
  title: '修改任务',
  description: '按 id 修改任务。可改 title / due_date(YYYY-MM-DD，传空串=清除) / due_time / priority(1-4) / description / in_sprint；换项目用 project（名或 id）。',
  inputSchema: {
    id: z.string(),
    title: z.string().optional(),
    due_date: z.string().optional(),
    due_time: z.string().optional(),
    priority: z.number().int().min(1).max(4).optional(),
    description: z.string().optional(),
    project: z.string().optional(),
    in_sprint: z.boolean().optional(),
  },
}, async ({ id, project, in_sprint, ...rest }) => {
  try {
    const patch: any = {}
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v
    if (in_sprint !== undefined) patch.in_sprint = in_sprint ? 1 : 0
    if (project) {
      const projects = await apiFetch('/projects')
      const rid = resolveProjectId(projects, project)
      if (!rid) return fail(`找不到项目「${project}」`)
      patch.project_id = rid
    }
    if (Object.keys(patch).length === 0) return fail('没有要修改的字段。')
    const t = await apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    return ok(`已更新：${formatTask(t)}`)
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('complete_task', {
  title: '完成任务',
  description: '按 id 把任务标记为完成。重复任务会自动推进到下一个周期。',
  inputSchema: { id: z.string() },
}, async ({ id }) => {
  try {
    const task = await apiFetch(`/tasks/${id}`)
    if (!task) return fail(`找不到任务 id=${id}`)
    if (task.completed) return ok(`任务「${task.title}」已经是完成状态。`)
    const updated = await apiFetch(`/tasks/${id}/toggle`, { method: 'PATCH' })
    return ok(`已完成：${formatTask(updated)}`)
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('delete_task', {
  title: '删除任务',
  description: '按 id 永久删除任务（含其子任务）。不可恢复，请谨慎使用。',
  inputSchema: { id: z.string() },
}, async ({ id }) => {
  try { await apiFetch(`/tasks/${id}`, { method: 'DELETE' }); return ok(`已删除任务 id=${id}`) }
  catch (e: any) { return fail(e.message) }
})

server.registerTool('set_sprint', {
  title: '加入/移出本周冲刺',
  description: '按 id 把任务加入(on=true)或移出(on=false)本周冲刺。',
  inputSchema: { id: z.string(), on: z.boolean() },
}, async ({ id, on }) => {
  try {
    const t = await apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ in_sprint: on ? 1 : 0 }) })
    return ok(`${on ? '已加入' : '已移出'}本周冲刺：${formatTask(t)}`)
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('list_projects', {
  title: '列出项目',
  description: '列出所有未归档的项目（名称 + id）。',
  inputSchema: {},
}, async () => {
  try {
    const projects = await apiFetch('/projects')
    const active = projects.filter((p: any) => !p.archived)
    return ok(active.map((p: any) => `${p.name} (id:${p.id})`).join('\n') || '（没有项目）')
  } catch (e: any) { return fail(e.message) }
})

server.registerTool('create_project', {
  title: '创建项目',
  description: '创建一个新项目。',
  inputSchema: { name: z.string(), color: z.string().optional() },
}, async ({ name, color }) => {
  try {
    const p = await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name, color }) })
    return ok(`已创建项目：${p.name} (id:${p.id})`)
  } catch (e: any) { return fail(e.message) }
})

/* 按 op 逐条把 proposals 通过既有 REST 落库，返回成功/失败摘要（apply=true 出口）。 */
async function applyProposals(proposals: Proposal[], projectId: string | null): Promise<string> {
  const lines: string[] = []
  const fails: string[] = []
  for (const p of proposals) {
    const f = p as Record<string, any>
    try {
      if (p.op === 'create') {
        const body: any = { title: f.title, project_id: projectId || 'inbox' }
        if (f.due_date) body.due_date = f.due_date
        if (f.due_time) body.due_time = f.due_time
        if (f.priority != null) body.priority = f.priority
        if (f.description) body.description = f.description
        const t = await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) })
        lines.push(`已创建：${formatTask(t)}`)
      } else if (p.op === 'update') {
        const { op: _op, task_id, ...patch } = f
        const t = await apiFetch(`/tasks/${task_id}`, { method: 'PATCH', body: JSON.stringify(patch) })
        lines.push(`已更新：${formatTask(t)}`)
      } else if (p.op === 'complete') {
        const task = await apiFetch(`/tasks/${f.task_id}`)
        if (!task) throw new Error(`找不到任务 id=${f.task_id}`)
        if (task.completed) {
          lines.push(`已经是完成状态：${task.title}`)
        } else {
          const t = await apiFetch(`/tasks/${f.task_id}/toggle`, { method: 'PATCH' })
          lines.push(`已完成：${formatTask(t)}`)
        }
      } else {
        await apiFetch(`/tasks/${f.task_id}`, { method: 'DELETE' })
        lines.push(`已删除任务 id=${f.task_id}`)
      }
    } catch (e: any) {
      fails.push(`${formatProposalLine(p)} → ${e?.message || e}`)
    }
  }
  let out = `已落库 ${lines.length}/${proposals.length} 条：\n${lines.join('\n')}`
  if (fails.length) out += `\n\n失败 ${fails.length} 条：\n${fails.join('\n')}`
  return out
}

server.registerTool('plan_tasks', {
  title: 'AI 规划任务',
  description:
    '把一段自然语言想法（brain_dump）交给 TaskFlow 内置的 AI 规划核心，基于应用自身上下文（现有任务快照、项目、用户 agent_rules、今天的日期折算）生成结构化任务计划——调用方不必自己拉全量任务再推理。返回三种结果之一：questions=信息不足，先回答澄清问题（把每题答案按顺序放进 answers 数组再调一次）；proposals=完整计划（apply=false 时仅供审阅，不落库）；确认后带 apply=true 再调一次，会按当次重新生成的计划逐条落库并返回摘要。project 可传项目名或 id（决定规划上下文与新任务归属）。需要 TaskFlow 服务端配置 TASKFLOW_AI_KEY（headless 回退；网页端为 BYOK）。',
  inputSchema: {
    brain_dump: z.string(),
    answers: z.array(z.string()).optional(),
    project: z.string().optional(),
    apply: z.boolean().optional(),
  },
}, async ({ brain_dump, answers, project, apply }) => {
  try {
    let projectId: string | null = null
    if (project) {
      const projects = await apiFetch('/projects')
      projectId = resolveProjectId(projects, project)
      if (!projectId) return fail(`找不到项目「${project}」。现有项目：${projects.map((p: any) => p.name).join('、')}`)
    }

    const r = await apiFetch('/plan', {
      method: 'POST',
      body: JSON.stringify({ brain_dump, answers, project_id: projectId || undefined }),
    })

    if (r.type === 'error') return fail(`AI 规划失败：${r.error}`)

    if (r.type === 'questions') {
      return ok(
        `需要先澄清以下问题（把每题的回答按顺序放进 answers 数组，再调一次 plan_tasks）：\n` +
        formatQuestionLines(r.questions),
      )
    }

    // r.type === 'proposals'
    const proposals: Proposal[] = r.proposals
    const metaLine = `（模型 ${r.meta?.model} · ${((r.meta?.latencyMs ?? 0) / 1000).toFixed(1)}s${r.meta?.repaired ? ' · 经修复重试' : ''}）`
    if (!apply) {
      return ok(
        `已生成计划（共 ${proposals.length} 条，未落库）：\n` +
        proposals.map((p, i) => `${i + 1}. ${formatProposalLine(p)}`).join('\n') +
        `\n${metaLine}\n确认后用相同参数加 apply=true 再调一次即可落库（会按当次重新生成的计划执行）。`,
      )
    }
    const summary = await applyProposals(proposals, projectId)
    return ok(`${summary}\n${metaLine}`)
  } catch (e: any) { return fail(e.message) }
})

async function main() {
  await server.connect(new StdioServerTransport())
  log(`ready. API=${API}`)
}
main().catch(e => { log('fatal', e); process.exit(1) })
