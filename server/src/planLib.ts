/* 规划核心的纯函数层（无 I/O）— 单测在 tests/plan.test.mjs。
   块提取 / JSON 解析 / zod 校验 / 修复消息构造 都在这里，plan.ts 只做编排与网络。
   注意：schema 是从 protocols.ts 的协议文本 + 旧客户端 applyProposals 逻辑推导的，
   三者必须保持一致（向后兼容：允许未知字段透传，见 looseObject）。 */
import { z } from 'zod'

/* ============ zod schemas ============ */

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/ // due_date 在 DB 里按字典序比较，必须是严格的 YYYY-MM-DD 且月日在合法范围
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/ // 协议说 HH:MM，对 "9:00" 宽容，但小时/分钟必须在合法范围

const dateField = z.string().regex(DATE_RE, '日期必须是 YYYY-MM-DD').nullish()
const timeField = z.string().regex(TIME_RE, '时间必须是 HH:MM').nullish()
const priorityField = z.number().int().min(1).max(4).nullish()

// 用 looseObject：模型多给的字段（如 in_sprint）原样透传给 REST，保持向后兼容。
const createOp = z.looseObject({
  op: z.literal('create'),
  title: z.string().min(1, 'create 必须有非空 title'),
  due_date: dateField,
  due_time: timeField,
  priority: priorityField,
  description: z.string().nullish(),
})

const updateOp = z.looseObject({
  op: z.literal('update'),
  task_id: z.string().min(1, 'update 必须有 task_id'),
  title: z.string().min(1).nullish(),
  due_date: dateField,
  due_time: timeField,
  priority: priorityField,
  description: z.string().nullish(),
})

const completeOp = z.looseObject({
  op: z.literal('complete'),
  task_id: z.string().min(1, 'complete 必须有 task_id'),
})

const deleteOp = z.looseObject({
  op: z.literal('delete'),
  task_id: z.string().min(1, 'delete 必须有 task_id'),
})

export const proposalSchema = z.discriminatedUnion('op', [createOp, updateOp, completeOp, deleteOp])
export const proposalsSchema = z.array(proposalSchema).min(1, 'proposals 数组不能为空')

export const questionSchema = z.looseObject({
  q: z.string().min(1, '问题文本不能为空'),
  options: z.array(z.string().min(1)).min(1, '每个问题至少要有一个选项'),
})
export const questionsSchema = z.array(questionSchema).min(1, 'questions 数组不能为空')

export type Proposal = z.infer<typeof proposalSchema>
export type Question = z.infer<typeof questionSchema>

/* ============ 判别联合结果 ============ */

export type ParsedPlan =
  | { type: 'proposals'; proposals: Proposal[] }
  | { type: 'questions'; questions: Question[] }
  | { type: 'error'; error: string }

/* ============ 块提取 ============ */

export interface FencedBlocks {
  proposals: string | null
  questions: string | null
}

/** 从模型原始输出中提取 ```proposals``` / ```questions``` fenced 块的内部文本。
    正则与旧版流式实现保持一致（服务端契约不变）。 */
export function extractBlocks(raw: string): FencedBlocks {
  const propMatch = raw.match(/```proposals\s*([\s\S]*?)```/)
  const qMatch = raw.match(/```questions\s*([\s\S]*?)```/)
  return {
    proposals: propMatch ? propMatch[1].trim() : null,
    questions: qMatch ? qMatch[1].trim() : null,
  }
}

/* ============ JSON 解析 + 校验 ============ */

function zodIssues(err: z.ZodError): string {
  return err.issues
    .map(i => (i.path.length ? `[${i.path.join('.')}] ` : '') + i.message)
    .slice(0, 5)
    .join('；')
}

function parseJsonArray(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text)
    if (!Array.isArray(value)) return { ok: false, error: '内容不是 JSON 数组' }
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败：${e?.message || e}` }
  }
}

export function validateProposals(value: unknown): { ok: true; proposals: Proposal[] } | { ok: false; error: string } {
  const r = proposalsSchema.safeParse(value)
  if (r.success) return { ok: true, proposals: r.data }
  return { ok: false, error: `proposals 校验失败：${zodIssues(r.error)}` }
}

export function validateQuestions(value: unknown): { ok: true; questions: Question[] } | { ok: false; error: string } {
  const r = questionsSchema.safeParse(value)
  if (r.success) return { ok: true, questions: r.data }
  return { ok: false, error: `questions 校验失败：${zodIssues(r.error)}` }
}

/** 解析一轮模型输出 → 判别联合。
    规则：proposals 块优先于 questions 块（两块并存时协议本就被违反，取可执行的那个）；
    有块但解析/校验失败 → error（由 plan.ts 触发一轮修复重试）；
    没有任何块时，宽容地尝试把整段输出当成裸 JSON 数组（模型常见跑偏），
    按元素形状归类（有 op → proposals，有 q → questions）。 */
export function parsePlanOutput(raw: string): ParsedPlan {
  if (!raw || !raw.trim()) return { type: 'error', error: '模型输出为空' }
  const blocks = extractBlocks(raw)

  if (blocks.proposals !== null) {
    const parsed = parseJsonArray(blocks.proposals)
    if (!parsed.ok) return { type: 'error', error: `proposals 块${parsed.error}` }
    const v = validateProposals(parsed.value)
    if (!v.ok) return { type: 'error', error: v.error }
    return { type: 'proposals', proposals: v.proposals }
  }

  if (blocks.questions !== null) {
    const parsed = parseJsonArray(blocks.questions)
    if (!parsed.ok) return { type: 'error', error: `questions 块${parsed.error}` }
    const v = validateQuestions(parsed.value)
    if (!v.ok) return { type: 'error', error: v.error }
    return { type: 'questions', questions: v.questions }
  }

  // 无 fenced 块：尝试把整段输出当裸 JSON 数组（去掉可能的裸 ``` 围栏）
  const bare = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  if (bare.startsWith('[')) {
    const parsed = parseJsonArray(bare)
    if (parsed.ok && Array.isArray(parsed.value) && parsed.value.length > 0) {
      const first = parsed.value[0]
      if (first && typeof first === 'object' && 'op' in (first as object)) {
        const v = validateProposals(parsed.value)
        if (v.ok) return { type: 'proposals', proposals: v.proposals }
        return { type: 'error', error: v.error }
      }
      if (first && typeof first === 'object' && 'q' in (first as object)) {
        const v = validateQuestions(parsed.value)
        if (v.ok) return { type: 'questions', questions: v.questions }
        return { type: 'error', error: v.error }
      }
    }
  }

  return { type: 'error', error: '输出中没有 ```proposals``` 或 ```questions``` 代码块' }
}

/* ============ 修复重试消息构造 ============ */

/** 解析/校验失败后追加到对话尾部的两条消息：把模型原始输出回灌 + 指出错误，
    要求只重发一个合法 fenced 块。附加到原 messages 之后再调一次模型。 */
export function buildRepairMessages(raw: string, error: string): { role: 'assistant' | 'user'; content: string }[] {
  return [
    { role: 'assistant', content: raw && raw.trim() ? raw : '（空输出）' },
    {
      role: 'user',
      content: `你上一条输出未通过解析/校验：${error}

请重新输出，要求：
- 只输出**一个** fenced 代码块（\`\`\`proposals 或 \`\`\`questions 二选一），块外不要有任何文字。
- 块内必须是合法 JSON 数组，字段名与取值严格符合协议（op 只能是 create/update/complete/delete；日期 YYYY-MM-DD；priority 1-4 的整数）。
- 不要解释、不要道歉。`,
    },
  ]
}

/* ============ 展示格式化（MCP 出口复用） ============ */

const OP_LABEL: Record<Proposal['op'], string> = { create: '新建', update: '修改', complete: '完成', delete: '删除' }

/** 单条 proposal 的一行摘要，给 MCP 调用方审阅计划用。 */
export function formatProposalLine(p: Proposal): string {
  // looseObject 的 catchall 让联合上的可选字段类型收窄困难，统一走 Record 视图读取
  const f = p as Record<string, unknown>
  const parts: string[] = []
  if (typeof f.title === 'string' && f.title) parts.push(f.title)
  if (typeof f.task_id === 'string' && f.task_id) parts.push(`(task_id:${f.task_id})`)
  if (typeof f.due_date === 'string' && f.due_date) {
    parts.push(`📅${f.due_date}${typeof f.due_time === 'string' && f.due_time ? ' ' + f.due_time : ''}`)
  }
  if (typeof f.priority === 'number' && f.priority < 4) parts.push(`P${f.priority}`)
  if (typeof f.description === 'string' && f.description) parts.push(`— ${f.description}`)
  return `[${OP_LABEL[p.op]}] ${parts.join(' ')}`
}

/** questions 的编号清单，提示调用方带 answers 再来一轮。 */
export function formatQuestionLines(questions: Question[]): string {
  return questions
    .map((q, i) => `${i + 1}. ${q.q}（选项：${q.options.join(' / ')}；也可自由回答）`)
    .join('\n')
}
