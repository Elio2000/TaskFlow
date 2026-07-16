/* AI 输出协议常量（本应用自己的约定，与 Claude Code 无关）。

   模型在回复末尾输出 fenced 代码块（```proposals``` / ```questions```），服务端
   （planLib.ts）解析并用 zod 校验后返回结构化结果，客户端渲染成卡片。
   这两段协议文本是系统契约：字段名/取值必须与 planLib 的 schema 和客户端
   PlannerBox 的采纳逻辑保持一致；改动任何一方都要同步另外两方。 */

// 任务操作协议 — 让模型知道 proposals 块的精确格式。没有它模型永远不会
// 输出 proposals，「采纳」也就永远建不了任务。
export const PROPOSAL_PROTOCOL = `

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

// 智能反问协议 — 关键信息不明确时，模型先输出 ```questions``` 块带选项澄清，
// 而不是瞎猜。用户的回答组成 answers 再来一轮，产出准确的 proposals。
export const QUESTION_PROTOCOL = `

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
