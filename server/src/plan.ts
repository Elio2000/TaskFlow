/* 一次性规划核心 planTasks() — 聊天面板「坍缩」后的唯一 AI 入口。
   两个出口共用这一套实现：POST /api/plan（网页 PlannerBox / BYOK）和 MCP 工具
   plan_tasks（headless，走 REST）。

   流程：分层组装 system prompt（agent_rules → 项目上下文/任务快照 → 日期锚定 →
   协议）→ 非流式 chat completion（60s 超时；网络错误/5xx/429 短退避重试一次）→
   planLib 解析 + zod 校验 → 失败则带原始输出+错误信息做一轮修复重试 → 判别联合。

   Provider 适配：沿用 PR #5 的 BYOK 适配层 —— 只认 OpenAI 兼容的 baseUrl + model
   + apiKey，不硬编码任何服务商；客户端用 providers.ts 把服务商预设解析成 baseUrl。 */
import type Database from 'better-sqlite3'
import { PROPOSAL_PROTOCOL, QUESTION_PROTOCOL } from './protocols.js'
import { parsePlanOutput, buildRepairMessages, type Proposal, type Question } from './planLib.js'

export interface PlanInput {
  brain_dump: string
  answers?: string[]
  project_id?: string | null
  apiKey: string
  baseUrl?: string
  model?: string
}

export interface PlanMeta {
  model: string
  latencyMs: number
  /** 因网络错误/5xx/429 额外发起的 HTTP 尝试次数（0-2，两轮各至多重试一次）。 */
  retries: number
  /** 最终结果是否来自修复重试轮（第一轮解析/校验失败后由模型重发修好）。 */
  repaired: boolean
}

export type PlanResult = (
  | { type: 'proposals'; proposals: Proposal[] }
  | { type: 'questions'; questions: Question[] }
  | { type: 'error'; error: string }
) & { meta: PlanMeta }

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const TIMEOUT_MS = 60_000
const RETRY_BACKOFF_MS = 800

/* ============ prompt 组装（分层结构沿用原聊天实现；已按定案移除聊天记忆/AGENTS.md，
   保留 agent_rules + 项目 + 任务快照 + 日期锚定） ============ */

function buildSystemPrompt(db: Database.Database, projectId?: string | null): string {
  let systemPrompt =
    '你是 TaskFlow 的 AI 规划器——一个专注「任务规划与时间分配」的智能体。你的职责：把用户倒出来的想法拆成可执行的任务、安排合理的时间与截止日期、识别冲突与遗漏。用中文，简洁有力。'

  // settings.agent_rules 覆盖基础角色（协议与日期仍会强制追加，这是系统契约）
  try {
    const agentRules = db.prepare("SELECT value FROM settings WHERE key = 'agent_rules'").get() as any
    if (agentRules?.value) systemPrompt = agentRules.value
  } catch {}

  // 项目上下文 + 任务快照（含状态/截止/备注/子任务），让模型基于应用自身状态规划
  if (projectId) {
    try {
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any
      if (proj) systemPrompt += `\n\n当前项目：${proj.name}`

      const tasks = db
        .prepare('SELECT * FROM tasks WHERE project_id = ? AND parent_id IS NULL ORDER BY completed ASC, sort_order ASC LIMIT 80')
        .all(projectId) as any[]
      if (tasks.length) {
        systemPrompt += '\n\n## 当前任务列表（含状态/截止/备注/子任务）\n' + tasks.map((t: any) => {
          const status = t.completed ? '[已完成]' : '[未完成]'
          const due = t.due_date ? ` | 截止:${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : ''
          const pri = t.priority < 4 ? ` | P${t.priority}` : ''
          const desc = t.description ? ` | 备注:${String(t.description).replace(/\s+/g, ' ').slice(0, 120)}` : ''
          const subs = db.prepare('SELECT title, completed FROM tasks WHERE parent_id = ? LIMIT 20').all(t.id) as any[]
          const subStr = subs.length ? ` | 子任务:${subs.map((s: any) => (s.completed ? '✓' : '○') + s.title).join('、')}` : ''
          return `[${t.id}] ${status} ${t.title}${due}${pri}${desc}${subStr}`
        }).join('\n')
      }
    } catch {}
  }

  // 日期锚定 + 协议 —— 永远追加，即使 agent_rules 覆盖了基础 prompt
  const now = new Date()
  const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  systemPrompt += `\n\n## 当前时间\n今天是 ${dateStr}（周${wd}）。所有相对日期（今天/明天/本周等）以此为基准。`
  systemPrompt += PROPOSAL_PROTOCOL
  systemPrompt += QUESTION_PROTOCOL

  // 一次性规划模式：没有多轮聊天，块外文字会被丢弃，必须以两种块之一收尾
  systemPrompt += `

## 一次性规划模式（重要）
这是一次「一次性规划」请求，不是聊天：
- 你的回复必须以 proposals 或 questions 代码块**之一**结尾（二选一，不能都给、也不能都不给）。
- 代码块之外的文字会被系统丢弃，请控制在一两句话以内。
- 信息基本够用就直接给 proposals；仅在关键信息确实缺失时才用 questions（至多一轮）。`

  return systemPrompt
}

function buildUserMessage(input: PlanInput): string {
  let msg = input.brain_dump.trim()
  if (input.answers && input.answers.length) {
    msg += '\n\n## 对澄清问题的回答\n' + input.answers.map(a => `- ${a}`).join('\n')
    msg += '\n\n（回答已补充完毕，请直接给出 proposals，不要再反问。）'
  }
  return msg
}

/* ============ 非流式 chat completion（超时 + 重试一次） ============ */

class ProviderError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

async function chatOnce(baseUrl: string, apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? `请求超时（${TIMEOUT_MS / 1000}s）` : `网络错误：${e?.message || e}`
    throw new ProviderError(msg, true)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let errMsg = `AI 服务返回 ${res.status}`
    try {
      const j = JSON.parse(errText)
      errMsg = j.error?.message || j.message || errMsg
    } catch {}
    // 429 / 5xx 值得重试；4xx（key 无效、模型不存在…）重试也没用
    throw new ProviderError(errMsg, res.status === 429 || res.status >= 500)
  }

  const data: any = await res.json().catch(() => null)
  return data?.choices?.[0]?.message?.content ?? ''
}

/** 网络错误/5xx/429 时短退避后重试一次。返回内容和为此多花的尝试次数。 */
async function chatWithRetry(baseUrl: string, apiKey: string, model: string, messages: ChatMessage[]): Promise<{ content: string; extraAttempts: number }> {
  try {
    return { content: await chatOnce(baseUrl, apiKey, model, messages), extraAttempts: 0 }
  } catch (e: any) {
    if (!(e instanceof ProviderError) || !e.retryable) throw e
    await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
    return { content: await chatOnce(baseUrl, apiKey, model, messages), extraAttempts: 1 }
  }
}

/* ============ 主入口 ============ */

export async function planTasks(db: Database.Database, input: PlanInput): Promise<PlanResult> {
  const t0 = Date.now()
  const baseUrl = (input.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = input.model || process.env.AI_PLANNER_MODEL || 'deepseek-chat'
  let retries = 0
  const meta = (repaired: boolean): PlanMeta => ({ model, latencyMs: Date.now() - t0, retries, repaired })

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(db, input.project_id) },
    { role: 'user', content: buildUserMessage(input) },
  ]

  // 第一轮
  let raw: string
  try {
    const r = await chatWithRetry(baseUrl, input.apiKey, model, messages)
    raw = r.content
    retries += r.extraAttempts
  } catch (e: any) {
    return { type: 'error', error: e?.message || '未知错误', meta: meta(false) }
  }

  const first = parsePlanOutput(raw)
  if (first.type !== 'error') return { ...first, meta: meta(false) }

  // 一轮修复重试：原始输出 + 错误信息回灌，要求只重发 fenced 块
  const repairMessages: ChatMessage[] = [...messages, ...buildRepairMessages(raw, first.error)]
  let repairedRaw: string
  try {
    const r = await chatWithRetry(baseUrl, input.apiKey, model, repairMessages)
    repairedRaw = r.content
    retries += r.extraAttempts
  } catch (e: any) {
    return { type: 'error', error: `解析失败（${first.error}），修复重试时请求出错：${e?.message || '未知错误'}`, meta: meta(false) }
  }

  const second = parsePlanOutput(repairedRaw)
  if (second.type !== 'error') return { ...second, meta: meta(true) }

  return { type: 'error', error: `模型两次输出都无法解析。第一次：${first.error}；修复后：${second.error}`, meta: meta(false) }
}
