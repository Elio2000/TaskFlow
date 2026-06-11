# TODO — ai-planner-lite 重构计划

> 项目经理：Claude  
> 执行方：Kimi  
> 目标：将现有混合架构（Python app.py + Node server）合并为**纯 Node.js 项目**，修复全部 bug，补全 Claude 设计稿功能。

---

## 架构现状（必读）

```
当前（坏的）：
  scripts/start.fish  →  python3 app.py（5055）  ←  AI 流式 + 旧 static/index.html
  client/（Vite dev）  →  server/（Node，3001）  →  [从未自动启动！]
                                                  ↓ 代理 AI 流到 5055
目标（好的）：
  npm run dev  →  server/（Node，3001）  ←  全部 API + AI 流式
                   ↑ 代理
  client/（Vite dev，5173）
```

**根本问题**：`start.fish` 只启 `app.py`，Node server 从未运行，所有客户端 API 调用静默失败。

---

## Phase 0 — 让项目能运行（Blocker，先做）

### P0-001  删除 app.py 依赖，统一启动命令

**问题**：`scripts/start.fish` 只运行 `python3 app.py`，Node server 不启动。  
**文件**：`scripts/start.fish`、`package.json`

**修改方案**：
1. 修改 `package.json`，在根 scripts 加：
   ```json
   "dev": "concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
   "start": "node --env-file=.env -e \"process.chdir('server')\" server/dist/index.js"
   ```
   其中 `dev:server` = `cd server && npm run dev`，`dev:client` = `cd client && npm run dev`。
2. 修改 `scripts/start.fish`，改为执行 `npm run dev`（或直接 `concurrently`）。
3. 确认 `server/` 下有 `npm install` 步骤。

**验收测试**：
```bash
npm run dev
# 期望：终端同时出现 "server running on 3001" 和 "vite dev server ready on 5173"
curl http://localhost:3001/api/projects
# 期望：返回 JSON 数组（含 inbox 项目）
curl http://localhost:5173
# 期望：返回 React HTML
```

---

### P0-002  修复 server/ 静态文件路径

**问题**：`server/src/index.ts:74` 写的是 `express.static('../client/dist')`，是相对于**进程 CWD** 的路径，从 `server/` 目录以外启动时失效。  
**文件**：`server/src/index.ts:74`

**修改方案**：
```typescript
// 改为
import { fileURLToPath } from 'url'
import path from 'path'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.join(__dirname, '../../client/dist')))
```

**验收测试**：
```bash
cd /tmp && node /Users/.../ai-planner-lite/server/dist/index.js
curl http://localhost:3001/
# 期望：返回 200 和 HTML（不是 404）
```

---

### P0-003  AI 流式接口迁移到 Node.js（去除 app.py 依赖）[SPLIT]

**问题**：现在 AI 流式接口在 `app.py`（5055），Node server 只做了一个反向代理。目标是把 AI 调用逻辑移到 Node.js 中，彻底去掉 Python 依赖。  
**文件**：`server/src/index.ts:47-71`（现有代理逻辑）  
需新建：`server/src/routes/ai.ts`

**新接口规格**（`POST /api/chat/stream`）：
```
请求 body:
  { "message": string, "project_id"?: string, "conv_id"?: string }

响应：text/event-stream，每个 SSE 事件：
  event: delta
  data: {"content": "文字片段"}

  event: done
  data: {"proposals": [...] | null}
```

**实现步骤**：
1. 在 `server/src/routes/ai.ts` 中实现 `POST /stream`：
   - 从 DB 读取 `agent.md` 内容（存在 `settings` 表，key=`agent_rules`，缺省用硬编码规则）
   - 从 DB 读取本项目的 `memories` 和 `agents_docs`
   - 从 DB 读取项目下最近 40 条未完成 tasks
   - 构建 system prompt（参考 `app.py:build_teacher_stream_messages`，用英文或中文均可）
   - 读 `.env` 中 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`AI_PLANNER_MODEL`
   - 用 Node `fetch`（或 `node-fetch`）POST 到 DeepSeek `/chat/completions`，`stream: true`
   - 把 DeepSeek SSE chunk 逐行解析后转发给客户端：
     ```
     event: delta
     data: {"content": "片段"}
     ```
   - 流结束后解析 AI 回复中的 proposals 代码块（`` ```proposals ... ``` ``），发送：
     ```
     event: done
     data: {"proposals": [...] | null}
     ```
2. 在 `server/src/index.ts` 删除现有 `app.post('/api/chat/stream', ...)` 代理，改为：
   ```typescript
   import { aiRoutes } from './routes/ai.js'
   app.use('/api/chat', aiRoutes())
   ```
3. `.env` 需要有：
   ```
   DEEPSEEK_API_KEY=sk-...
   DEEPSEEK_BASE_URL=https://api.deepseek.com
   AI_PLANNER_MODEL=deepseek-chat
   ```

**验收测试**：
```bash
curl -N -X POST http://localhost:3001/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"你好，帮我规划今天"}'
# 期望：终端实时打印 SSE 事件流，每行格式 "data: {..."
# 期望：最后一条 event: done
```

---

## Phase 1 — 核心功能 Bug 修复

### P1-001  任务 labels 字段 PATCH 无效

**问题**：`server/src/routes/tasks.ts:69`，`fields` 数组里没有 `labels`，导致 PATCH 任务时无论传什么 labels 都不会更新。代码第 73 行的 `f === 'labels' ? JSON.stringify(body[f])` 永远不执行。  
**文件**：`server/src/routes/tasks.ts:69`

**修改方案**：
```typescript
// 改前
const fields = ['project_id', 'section_id', 'parent_id', 'title', 'description',
  'start_date', 'due_date', 'due_time', 'end_time', 'repeat', 'priority',
  'reminder', 'completed', 'completed_at', 'sort_order']

// 改后（加 labels）
const fields = ['project_id', 'section_id', 'parent_id', 'title', 'description',
  'start_date', 'due_date', 'due_time', 'end_time', 'repeat', 'priority', 'labels',
  'reminder', 'completed', 'completed_at', 'sort_order']

// 同时修复序列化逻辑（当前第 73 行条件永远 false，改为）：
for (const f of fields) {
  if (f in body) {
    sets.push(`${f} = ?`)
    params.push(f === 'labels' ? JSON.stringify(body[f]) : body[f])
  }
}
```

**验收测试**：
```bash
# 先创建任务，记下 id
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试标签","priority":3}' | jq -r .id)

# 获取一个 label id
LABEL_ID=$(curl -s http://localhost:3001/api/labels | jq -r '.[0].id')

# PATCH labels
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d "{\"labels\": [\"$LABEL_ID\"]}"

# 验证
curl -s http://localhost:3001/api/tasks/$TASK_ID | jq .labels
# 期望：包含 LABEL_ID 的 JSON 数组字符串，不是 "[]"
```

---

### P1-002  删除任务后 UI 不刷新

**问题**：`client/src/components/TaskRow.tsx:15`，`handleDelete` 调用 `api.deleteTask` 后没有通知父组件刷新，任务在 5 秒轮询前依然显示。  
**文件**：`client/src/components/TaskRow.tsx`

**修改方案**：
1. 给 `TaskRowProps` 增加可选回调 `onDelete?: () => void`
2. `handleDelete` 改为：
   ```typescript
   const handleDelete = async (e: React.MouseEvent) => {
     e.stopPropagation()
     await api.deleteTask(task.id)
     onDelete?.()
   }
   ```
3. 所有使用 `TaskRow` 的地方（`Views.tsx` 中 6 处，`TaskModal.tsx`）补传 `onDelete={fetch}` 或 `onDelete={onClose}`。

**验收测试**：
- 打开收件箱，点击任意任务的删除按钮（垃圾桶图标）
- 期望：任务**立即**从列表消失，不用等 5 秒

---

### P1-003  AIPanel SSE 解析错误导致显示乱码

**问题**：`client/src/ai/AIPanel.tsx:148-155`，直接把 SSE 字节流拼成字符串 `fullResponse += chunk`。实际上后端发的是 `event: delta\ndata: {...}\n\n` 格式，拼接后 `fullResponse` 包含完整 SSE 协议文本而不是 AI 内容。  
**文件**：`client/src/ai/AIPanel.tsx:130-180`

**修改方案**：用 `EventSource` 或手动解析 SSE：
```typescript
const send = async () => {
  // ... 保存用户消息 ...
  setThinking(true)
  let fullContent = ''

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, project_id: projectId, conv_id: convId }),
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  // 实时显示：在消息列表末尾追加一条 streaming 占位
  const streamingId = 'streaming'
  setMessages(prev => [...prev, { id: streamingId, role: 'assistant', content: '', conversation_id: convId!, refs: '[]', proposals: null, proposals_applied: 0, created_at: '' }])

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const obj = JSON.parse(line.slice(6))
          if (obj.content) {
            fullContent += obj.content
            // 更新占位消息内容
            setMessages(prev => prev.map(m => m.id === streamingId ? { ...m, content: fullContent } : m))
          }
          if ('proposals' in obj) {
            // done 事件：保存正式消息并移除占位
            const saved = await api.addMessage(convId!, 'assistant', fullContent, { proposals: obj.proposals })
            setMessages(prev => prev.filter(m => m.id !== streamingId).concat(saved))
          }
        } catch {}
      }
    }
  }
  setThinking(false)
}
```

**验收测试**：
- 打开 AI 面板，发送「你好」
- 期望：AI 回复文字**逐字实时显示**，不是等全部完成后才出现
- 期望：回复框里不出现 `event:` / `data:` 等 SSE 协议文本

---

### P1-004  QuickComposer 在日历/即将视图不预填日期

**问题**：`Views.tsx` 中 `CalendarView`（第 211 行）和 `UpcomingView`（第 148 行）的 `<QuickComposer>` 没有传入当前选中日期，创建的任务没有 `due_date`，在今日视图不可见。  
**文件**：`client/src/views/Views.tsx`、`client/src/components/QuickComposer.tsx`

**修改方案**：
1. `QuickComposer` props 增加 `defaultDueDate?: string`
2. `submit()` 中：`if (!parsed?.due_date && defaultDueDate) body.due_date = defaultDueDate`
3. `CalendarView` 改为：
   ```tsx
   <QuickComposer projectId="inbox" defaultDueDate={selected} placeholder="为这天添加任务…" autoFocus={false} onDone={fetch} />
   ```
4. `UpcomingView` 每个 day row 改为：
   ```tsx
   <QuickComposer projectId="inbox" defaultDueDate={day.date} placeholder="+ 为这天添加任务" autoFocus={false} onDone={fetch} />
   ```

**验收测试**：
- 打开日历视图，点击明天的格子，在右侧输入框输入「测试任务」回车
- 期望：今日视图列表里**不**出现该任务（due_date 是明天）
- 打开即将到来，在「明天」行下面输入「另一个任务」回车
- 期望：该任务 due_date = 明天日期（通过 `api.getTask` 验证）

---

### P1-005  Board 视图拖拽全局变量竞态

**问题**：`client/src/views/Views.tsx:227-228`，`boardDrag` 和 `boardHandleDown` 是模块级可变变量，多实例或快速操作时会互相干扰。  
**文件**：`client/src/views/Views.tsx:227-228`

**修改方案**：改为 `useRef` 在 `BoardView` 组件内管理：
```typescript
export function BoardView({ projectId }: { projectId: string }) {
  const boardDrag = useRef<{ taskId: string | null; fromSection: string | null }>({ taskId: null, fromSection: null })
  const boardHandleDown = useRef(false)
  // 把 boardDrag 和 boardHandleDown 通过 props 传给 BoardCard / BoardCol
  // ...
}
```
或者用 React context 传递。

**验收测试**：
- 在看板视图快速连续拖动两张卡片
- 期望：两次操作都正确移动到目标列，不出现卡片"消失"或"跳回"

---

### P1-006  Memory/AgentsDoc/Settings 路由耦合

**问题**：`server/src/index.ts:44-45` 把三个不同功能的路径挂到同一个 `memoryRoutes()`，内部通过 `req.baseUrl` 区分，脆弱且难维护。  
**文件**：`server/src/index.ts:39-45`、`server/src/routes/memory.ts`

**修改方案**：
1. 拆成三个独立路由文件：`server/src/routes/memories.ts`、`server/src/routes/agentsDoc.ts`、`server/src/routes/settings.ts`
2. 每个文件只处理自己的逻辑，去掉 `req.baseUrl` 判断
3. `index.ts` 改为：
   ```typescript
   app.use('/api/memories', memoriesRoutes())
   app.use('/api/agents-doc', agentsDocRoutes())
   app.use('/api/settings', settingsRoutes())
   ```

**验收测试**：
```bash
# agents-doc
curl -X PUT http://localhost:3001/api/agents-doc/inbox \
  -H 'Content-Type: application/json' -d '{"content":"测试规则"}'
curl http://localhost:3001/api/agents-doc/inbox
# 期望：{ "content": "测试规则", "updated_at": "..." }

# settings
curl -X PUT http://localhost:3001/api/settings/theme \
  -H 'Content-Type: application/json' -d '{"value":"dark"}'
curl http://localhost:3001/api/settings/theme
# 期望：{ "key": "theme", "value": "dark" }
```

---

### P1-007  主题设置不持久化

**问题**：`client/src/App.tsx`，主题切换只改了 `document.documentElement.setAttribute`，刷新后恢复默认。`api.getSetting('theme')` 在 db 里有数据但从未被读取。  
**文件**：`client/src/App.tsx`

**修改方案**：
```typescript
// 初始化时从 API 读取
useEffect(() => {
  api.getSetting('theme').then(({ value }) => {
    if (value) { setTheme(value); document.documentElement.setAttribute('data-theme', value) }
  })
}, [])

// 切换时写入
const toggleTheme = () => {
  const next = theme === 'light' ? 'dark' : 'light'
  setTheme(next)
  document.documentElement.setAttribute('data-theme', next)
  api.setSetting('theme', next)
}
```
同时在 Sidebar 底部（或 App 顶部）加一个主题切换按钮，调用 `toggleTheme`。

**验收测试**：
- 切换到深色主题，刷新页面
- 期望：页面仍然是深色主题（不恢复浅色）

---

## Phase 2 — Claude 设计稿功能补全

### P2-001  AI 面板 @ 引用选择器（Claude 设计稿有，当前无）[SPLIT]

**参考**：`Claude/app/ai-panel.jsx:50-110`（`MentionMenu` 组件）  
**文件**：`client/src/ai/AIPanel.tsx`

**功能描述**：输入框输入 `@` 后弹出任务/项目选择菜单，选中后自动插入 `@任务标题（id）` 引用文本，AI prompt 中会注入该任务的完整上下文。

**实现步骤**：
1. 在 `AIPanel.tsx` 中监听输入框的 `@` 触发
2. 拉取未完成 tasks 和 projects（`api.getTasks()`、`api.getProjects()`）
3. 渲染浮动下拉菜单（复用 `Popover` 组件）
4. 选中后拼入文本：`@${task.title}（#${task.id}）`
5. 在发送前从消息文本中解析 `@...（#id）` 引用，把相关 task 完整信息追加到 system prompt

**验收测试**：
- AI 面板输入框输入 `@整理`
- 期望：弹出下拉，显示包含"整理"的任务列表
- 选中某任务，期望文本框填入 `@任务标题（#id）`
- 发送后，期望 AI 的回复中体现了对该任务的了解（如提到任务标题）

---

### P2-002  任务分组折叠（Claude 设计稿有 TaskGroup，当前列表无折叠）

**参考**：`Claude/app/views.jsx:33-47`（`TaskGroup` 组件）  
**文件**：`client/src/views/Views.tsx`、新建 `client/src/components/TaskGroup.tsx`

**功能描述**：任务列表中「逾期」「今天」「已完成」等分组可折叠/展开，带任务计数。

**实现步骤**：
```typescript
// client/src/components/TaskGroup.tsx
export function TaskGroup({ title, tasks, defaultOpen = true, accent, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:7, padding:'4px 0', marginBottom: open ? 4 : 0, background:'none', border:'none', cursor:'pointer', width:'100%' }}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize:13, fontWeight:600, color: accent || 'var(--text-secondary)' }}>{title}</span>
        <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>{tasks.length}</span>
      </button>
      {open && children}
    </div>
  )
}
```
在 `TodayView`、`InboxView` 中用 `TaskGroup` 包裹各分组。

**验收测试**：
- 今日视图中「逾期」分组点击标题行
- 期望：逾期任务列表折叠/展开，图标切换

---

### P2-003  /compact 命令压缩对话历史到 Memory

**参考**：`Claude/app/ai-panel.jsx`（`/compact` 逻辑）、`app.py:2033`（现有实现）  
**文件**：`client/src/ai/AIPanel.tsx`

**当前状态**：已有 `/compact` 逻辑（第 117 行）但太简单，只清空消息和写一条 `[Compressed]` system 消息。

**修改方案**：
1. `/compact` 触发时，把最近 N 条消息内容拼成摘要字符串
2. 调用 `api.addMemory(projectId, summary, 'compact')` 写入长期记忆
3. 调用 `api.clearMessages(convId)` 清空对话
4. 用 `api.addMessage(convId, 'system', '已压缩 N 条对话为长期记忆')` 写入提示
5. 刷新消息列表

**验收测试**：
- 发送 5 条以上消息，输入 `/compact` 回车
- 期望：对话清空，只剩 system 提示
- 打开「记忆」标签页，期望出现一条 source=compact 的记忆

---

### P2-004  Sidebar「导出数据」按钮加 Settings 入口

**参考**：`Claude/app/app.jsx`（设置入口）  
**文件**：`client/src/components/Sidebar.tsx`

**修改方案**：
在侧栏底部增加两个按钮：
- 「深色/浅色」主题切换（配合 P1-007）
- 「设置」入口，点击后弹出简单 Modal，可以修改 agent rules（`api.setSetting('agent_rules', ...)` 或 `api.setAgentsDoc(...)`）

**验收测试**：
- 点击侧栏底部主题切换按钮
- 期望：界面主题立即切换（深/浅），刷新后保持

---

## Phase 3 — 清理与测试基础设施

### P3-001  删除 app.py 及相关 Python 文件

完成 Phase 0+1 后，确认以下文件/目录可以删除（`git rm`）：
- `app.py`
- `codex_bridge.mjs`（Codex SDK 桥，Node 版已不需要）
- `deepseek_responses_proxy.mjs`
- `planner-output.schema.json`
- `tests/test_app.py`
- `static/`（旧 Python 版 HTML）
- `.pids/`

保留：
- `agent.md`（迁移内容到 DB `settings` 表 key=`agent_rules`，或继续读文件）
- `data/memory/`（迁移内容到 DB `memories` 表，或继续读文件）
- `Claude/`（设计参考，保留但加入 `.gitignore` 可选）

**验收测试**：
```bash
npm run dev
# 期望：无 Python 相关输出，所有功能正常
python3 app.py
# 期望：命令可以不存在或忽略（不影响 npm run dev）
```

---

### P3-002  补全根目录 package.json scripts

**文件**：`package.json`

**目标 scripts**：
```json
{
  "dev": "concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
  "dev:server": "cd server && npm run dev",
  "dev:client": "cd client && npm run dev",
  "build": "cd client && npm run build",
  "start": "cd server && node dist/index.js",
  "install:all": "npm install && cd server && npm install && cd ../client && npm install",
  "test": "node --test tests/proxy.test.mjs"
}
```

---

### P3-003  端到端手动测试清单

执行以下所有步骤，均应无控制台报错：

**任务管理**
- [ ] 收件箱创建任务（输入「明天下午2点 p1 测试任务」，验证 due_date、due_time、priority 解析正确）
- [ ] 打开任务 Modal，修改标题、描述、优先级、标签，保存后重新打开验证保存
- [ ] 在看板视图拖动任务到不同列，刷新后位置保持
- [ ] 在列表视图创建分区，移动任务到分区
- [ ] 删除任务，期望立即消失（P1-002 验证）

**日期视图**
- [ ] 今日视图：有到期任务时显示，完成后移到「已完成」分组
- [ ] 即将到来：在某天行创建任务，期望 due_date = 那天（P1-004 验证）
- [ ] 日历视图：选中某格，右侧任务列表正确显示，QuickComposer 创建任务 due_date 为选中日期

**AI 功能**
- [ ] AI 面板发送消息，期望实时流式显示文字（P1-003 验证）
- [ ] AI 回复包含 proposals 时，点「应用全部」，验证任务被创建

**主题**
- [ ] 切换深色主题，刷新页面，期望保持深色（P1-007 验证）

---

## 优先级总览

> Kimi：每次 session 在「状态」列填写 `✅ DONE` / `✅ ALREADY DONE` / `🚫 BLOCKED`

| 编号 | 优先级 | 预估工时 | 依赖 | 状态 |
|------|--------|----------|------|------|
| P0-001 | 🔴 Blocker | 30min | — | ✅ DONE |
| P0-002 | 🔴 Blocker | 15min | — | ✅ DONE |
| P0-003 [SPLIT] | 🔴 Blocker | 3-4h | P0-001 | ✅ DONE |
| P1-001 | 🟠 High | 15min | P0-001 | ✅ DONE |
| P1-002 | 🟠 High | 20min | P0-001 | ✅ DONE |
| P1-003 | 🟠 High | 1h | P0-003 | ✅ DONE |
| P1-004 | 🟠 High | 20min | P0-001 | ✅ DONE |
| P1-005 | 🟡 Medium | 30min | P0-001 | ✅ DONE |
| P1-006 | 🟡 Medium | 45min | P0-001 | ✅ DONE |
| P1-007 | 🟡 Medium | 20min | P1-006 | ✅ DONE |
| P1-008 | 🟠 High | 10min | P1-006 | ✅ DONE |
| P2-001 [SPLIT] | 🟢 Feature | 2h | P1-003 | ✅ DONE |
| P2-002 | 🟢 Feature | 1h | P0-001 | ✅ DONE |
| P2-003 | 🟢 Feature | 30min | P1-003 | ✅ DONE |
| P2-004 | 🟢 Feature | 30min | P1-007 | ✅ DONE |
| P3-001 ⚠️ | 🔵 Cleanup | 30min | 全部 Phase 0+1 | 待确认 |
| P3-002 | 🔵 Cleanup | 15min | P3-001 | ✅ ALREADY DONE |

**建议执行顺序**：P1-008 → P2-001 → P2-002 → P2-003 → P2-004 → P3-001 → P3-002 → P3-003

> ⚠️ P3-001 涉及永久删除文件（项目无 git），需 PM 在对话里明确确认文件列表后才能执行。

---

## Phase 1 补充（审核后新增）

### P1-008  删除死代码 server/src/routes/memory.ts

**问题**：P1-006 完成后，路由已拆为 `memories.ts`、`agentsDoc.ts`、`settings.ts` 三个独立文件，`server/src/index.ts` 不再挂载旧的 `memory.ts`。但该文件仍然存在，包含过时的 `req.baseUrl` 判断逻辑，容易让未来的读者困惑。  
**文件**：`server/src/routes/memory.ts`

**修改方案**：
```bash
rm server/src/routes/memory.ts
```

**验收测试**：
```bash
# 文件不存在
ls server/src/routes/memory.ts
# 期望：ls: cannot access '...memory.ts': No such file or directory

# server 仍能正常启动（paths: memories/agents-doc/settings 均正常）
curl -s http://localhost:3001/api/memories | head -c 5
# 期望：[ 或 []（JSON 数组）

curl -s http://localhost:3001/api/settings/theme
# 期望：{"key":"theme","value":"light"} 或 null 的 JSON

curl -s "http://localhost:3001/api/agents-doc/inbox"
# 期望：{"content":"...","updated_at":...} 的 JSON
```
