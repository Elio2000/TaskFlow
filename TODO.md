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

### P3-001  删除 app.py 及相关 Python 文件 — ✅ DONE

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
| P3-001 ⚠️ | 🔵 Cleanup | 30min | 全部 Phase 0+1 | ✅ DONE |
| P3-002 | 🔵 Cleanup | 15min | P3-001 | ✅ ALREADY DONE |
| P4-001 | 🟠 High | 5min | — | ✅ DONE |
| P4-002 | 🟠 High | 20min | P4-004 | ✅ DONE |
| P4-003 | 🟡 Medium | 10min | — | ✅ DONE |
| P4-004 | 🔴 Blocker | 15min | — | ✅ DONE |
| P5-001 [SPLIT] | 🟢 Feature | 4-6h | — | ⬜ TODO |
| P6-001 | 🟢 Feature | 1h | — | ✅ ALREADY DONE |
| P6-003 | 🟢 Feature | 45min | — | ⬜ TODO |
| P7-001 | 🟣 Plane | 4h | P4-004 | ⬜ TODO |
| P7-002 | 🟣 Plane | 2h | P4-004 | ⬜ TODO |
| P7-003 | 🟣 Plane | 2h | — | ⬜ TODO |

**建议执行顺序**：
`P4-004 → P4-003 → P4-001 → P4-002 → P5-001 → P6-001 → P6-003 → P7-003 → P7-002 → P7-001 → P3-003`

> ⚠️ P3-001 涉及永久删除文件（项目无 git），已由 PM 确认并执行完毕。

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

---

## Phase 4 — 新发现 Bug 修复（第二轮审核后新增）

> 对比 `Claude/app/` 参考设计 vs 当前实现发现的问题。

---

### P4-004  TaskCheckbox 切换后 UI 不刷新（卡顿根因）— ✅ DONE

**问题**：`client/src/components/TaskCheckbox.tsx:22`，`onClick` 调用 `api.toggleTask` 后没有任何回调，父组件靠 5 秒轮询才能看到变化。所有视图的完成/取消都有最多 5 秒延迟。  
**文件**：
- `client/src/components/TaskCheckbox.tsx`
- `client/src/components/TaskRow.tsx`（向下传 onToggle）
- `client/src/views/Views.tsx`（BoardCard 等处传 onRefresh）

**修改方案**：

```typescript
// TaskCheckbox.tsx — 改前
interface TaskCheckboxProps {
  task: Task
  size?: number
}
// onClick 内：api.toggleTask(task.id)  // 无回调

// TaskCheckbox.tsx — 改后
interface TaskCheckboxProps {
  task: Task
  size?: number
  onToggle?: () => void   // 新增
}
// onClick 内：
onClick={async (e) => {
  e.stopPropagation()
  await api.toggleTask(task.id)
  onToggle?.()
}}
```

```typescript
// TaskRow.tsx — 改前
interface TaskRowProps {
  task: Task
  onClick?: () => void
  onAIClick?: (task: Task) => void
  onDelete?: () => void
}
// 传给 TaskCheckbox 时无 onToggle

// TaskRow.tsx — 改后
interface TaskRowProps {
  task: Task
  onClick?: () => void
  onAIClick?: (task: Task) => void
  onDelete?: () => void
  onToggle?: () => void   // 新增
}
// 传给 TaskCheckbox：<TaskCheckbox task={task} onToggle={onToggle} />
```

所有调用 `<TaskRow>` 的地方（InboxView、TodayView、UpcomingView、CalendarView、ListView）补传 `onToggle={fetch}`。

**验收测试**：
```bash
# 1. 启动服务 npm run dev
# 2. 在收件箱创建一个任务
# 3. 点击 checkbox 完成任务
# 期望：任务立即（<200ms）从列表消失，不需要等待
# 4. 在今日视图完成一个任务
# 期望：立即移入"已完成"分组
```

---

### P4-001  InboxView 显示已完成任务 — ✅ DONE

**问题**：`client/src/views/Views.tsx:70`，InboxView 的 fetch 没有过滤 `completed=0`，seed 数据里的"已完成的示例任务"会混入收件箱，用户看到带删除线的任务。  
**文件**：`client/src/views/Views.tsx:70`

**修改方案**：
```typescript
// 改前
const fetch = () => api.getTasks({ project_id: 'inbox' }).then(setTasks)

// 改后
const fetch = () => api.getTasks({ project_id: 'inbox', completed: 0 }).then(setTasks)
```

**验收测试**：
```bash
curl -s "http://localhost:3001/api/tasks?project_id=inbox&completed=0" | jq 'map(select(.completed == 1)) | length'
# 期望：0（无已完成任务被返回）

# UI：打开收件箱，不显示任何带删除线的任务
# UI：完成一个任务后立即从收件箱消失（需先完成 P4-004）
```

---

### P4-002  BoardCard 无法直接完成任务 — ✅ DONE

**问题**：`client/src/views/Views.tsx:237-260`，`BoardCard` 只有标题+chips，没有 checkbox，只能点开 modal 才能完成任务。参考设计每个看板卡片左侧有 checkbox。  
**文件**：`client/src/views/Views.tsx`（BoardCard + BoardCol）

**修改方案**：
```typescript
// BoardCard props — 改后（加 onRefresh）
function BoardCard({ task, sectionId, onOpenTask, dragRef, handleDownRef, onRefresh }: {
  task: Task; sectionId: string | null; onOpenTask: (t: Task) => void;
  dragRef: React.MutableRefObject<DragState>; handleDownRef: React.MutableRefObject<boolean>;
  onRefresh: () => void;   // 新增
}) {
  return (
    <div data-task-id={task.id} className="board-card" draggable
      // ...（其余 drag handlers 不变）
      style={{ position: 'relative', paddingLeft: 44 }}>  {/* paddingLeft 增大 */}
      {/* drag handle 位置不变 */}
      <span className="board-drag-handle" ...>⠿</span>
      {/* 新增：checkbox 阻止拖拽冒泡 */}
      <div style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)' }}
           onMouseDown={(e) => e.stopPropagation()}>
        <TaskCheckbox task={task} onToggle={onRefresh} />
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, ... }}>{task.title}</div>
      <TaskChips task={task} />
    </div>
  )
}
```

同时在 `BoardCol` 的 `tasks.map` 里给 `BoardCard` 传 `onRefresh={onRefresh}`。

**注意**：需先完成 P4-004（TaskCheckbox 加 onToggle），否则 checkbox 点击无效。

**验收测试**：
- 打开任意项目的看板视图
- 每张卡片左侧应显示 checkbox（带优先级颜色）
- 点击 checkbox → 卡片立即从该列消失（已完成任务被 `!t.completed` 过滤掉）

---

### P4-003  删除死代码文件 — ✅ DONE

**问题**：以下两个文件均为死代码，无任何文件 import 或挂载它们：
1. `client/src/views/InboxView.tsx`：有独立定义的简化版 InboxView + TaskRow，从未被 import
2. `server/src/routes/memory.ts`：P1-006 完成后被取代，未挂载到 index.ts

**修改方案**：
```bash
rm -f client/src/views/InboxView.tsx
rm -f server/src/routes/memory.ts
```

**验收测试**：
```bash
# 确认文件不存在
ls client/src/views/InboxView.tsx 2>&1
# 期望：No such file or directory

ls server/src/routes/memory.ts 2>&1
# 期望：No such file or directory

# 确认 API 仍然正常
curl -s http://localhost:3001/api/memories | head -c 5
# 期望：[ 或 []

curl -s http://localhost:3001/api/settings/theme
# 期望：JSON 对象

curl -s "http://localhost:3001/api/agents-doc/inbox"
# 期望：JSON 对象

# 前端无 JS 错误（打开收件箱页面，控制台无 Error）
```

---

## Phase 5 — 大功能补全

---

### P5-001  日历日/周/月三视图 [SPLIT] — ✅ DONE

**问题**：当前 `CalendarView` 只有月份网格。参考设计 `Claude/app/calendar.jsx` 有月/周/日三种视图模式，周/日视图有 24 小时时间轴，支持在时间槽点击创建任务。  
**参考文件**：`Claude/app/calendar.jsx`  
**文件（Client，Agent-B 负责）**：新建 `client/src/views/CalendarView.tsx`，并在 `client/src/views/Views.tsx` 中 re-export

**Server 侧**：不需要改动（`/api/tasks?due_date=YYYY-MM-DD` 已够用）

#### Client 实现规格

**步骤 1 — 拆出独立文件**
- 新建 `client/src/views/CalendarView.tsx`
- 将 `Views.tsx` 中现有 `CalendarView` 函数移入，并在 `Views.tsx` 末尾 re-export：
  ```typescript
  export { CalendarView } from './CalendarView'
  ```

**步骤 2 — 顶部视图切换器**
```typescript
type CalMode = 'month' | 'week' | 'day'
const [mode, setMode] = useState<CalMode>('month')
const [cursor, setCursor] = useState(DateU.today())

// navigate 函数：month+-1月, week+-7天, day+-1天
const navigate = (dir: 1 | -1) => {
  if (mode === 'month') setCursor(DateU.addMonths(cursor, dir))
  else if (mode === 'week') setCursor(DateU.addDays(cursor, dir * 7))
  else setCursor(DateU.addDays(cursor, dir))
}
```

顶部 toolbar（在 ViewShell 的 actions slot 或 header 下方）：
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
  <button className="btn-ghost" onClick={() => navigate(-1)}>‹</button>
  <button className="btn-ghost" onClick={() => setCursor(DateU.today())}>今天</button>
  <button className="btn-ghost" onClick={() => navigate(+1)}>›</button>
  <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{titleFor(mode, cursor)}</span>
  {(['month','week','day'] as CalMode[]).map(m => (
    <button key={m}
      className={mode === m ? 'btn-primary' : 'btn-ghost'}
      style={{ fontSize: 12.5, padding: '3px 10px' }}
      onClick={() => setMode(m)}>
      {{ month: '月', week: '周', day: '日' }[m]}
    </button>
  ))}
</div>
```

**titleFor 函数**（参考 Claude/app/calendar.jsx）：
- month：`2026年6月`
- week：`6月9日 – 6月15日`
- day：`6月11日 周四`

**步骤 3 — MonthView 增强（任务 pill）**

当前月视图每格只显示 1-3 个颜色点，改为显示任务 pill 列表：
```typescript
// 在月格子内
const cellTasks = tasks.filter(t => t.due_date === cell.date && !t.completed)
// 渲染
{cellTasks.slice(0, 3).map(t => (
  <div key={t.id}
    onClick={(e) => { e.stopPropagation(); setTaskModal(t.id) }}
    style={{
      fontSize: 11, padding: '1px 4px', borderRadius: 3, marginBottom: 1,
      background: 'var(--accent-soft)', color: 'var(--accent-text)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      cursor: 'pointer'
    }}>
    {t.title}
  </div>
))}
{cellTasks.length > 3 && (
  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>+{cellTasks.length - 3}</div>
)}
```

**步骤 4 — WeekView / DayView（TimeGrid）**

新建组件 `TimeGrid`（在 CalendarView.tsx 内，不导出）：

```typescript
const HOUR_PX = 56  // 每小时高度（px）

function TimeGrid({ dates, tasks, onSlotClick, onOpenTask }: {
  dates: string[]      // 周视图 7 个日期，日视图 1 个
  tasks: Task[]
  onSlotClick: (date: string, hour: number) => void
  onOpenTask: (t: Task) => void
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  
  return (
    <div style={{ display: 'flex', flex: 1, overflowY: 'auto' }}>
      {/* 时间轴列 */}
      <div style={{ width: 48, flexShrink: 0, position: 'relative' }}>
        {hours.map(h => (
          <div key={h} style={{ height: HOUR_PX, display: 'flex', alignItems: 'flex-start',
            paddingTop: 2, paddingRight: 8, fontSize: 11, color: 'var(--text-tertiary)',
            justifyContent: 'flex-end' }}>
            {h === 0 ? '' : `${h}:00`}
          </div>
        ))}
      </div>
      
      {/* 日期列 */}
      {dates.map(date => (
        <DayCol key={date} date={date}
          tasks={tasks.filter(t => t.due_date === date && t.due_time && !t.completed)}
          allDayTasks={tasks.filter(t => t.due_date === date && !t.due_time && !t.completed)}
          onSlotClick={(hour) => onSlotClick(date, hour)}
          onOpenTask={onOpenTask} />
      ))}
    </div>
  )
}
```

`DayCol` 组件：
```typescript
function DayCol({ date, tasks, allDayTasks, onSlotClick, onOpenTask }) {
  const isToday = date === DateU.today()
  const [currentMin, setCurrentMin] = useState(getNowMinutes())
  
  useEffect(() => {
    const id = setInterval(() => setCurrentMin(getNowMinutes()), 60000)
    return () => clearInterval(id)
  }, [])
  
  return (
    <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-soft)', position: 'relative' }}>
      {/* 全天任务行 */}
      <div style={{ minHeight: 32, borderBottom: '1px solid var(--border-soft)', padding: '2px 4px' }}>
        {allDayTasks.slice(0, 2).map(t => (
          <div key={t.id} onClick={() => onOpenTask(t)} style={{ fontSize: 11, padding: '1px 4px',
            borderRadius: 3, background: 'var(--accent-soft)', color: 'var(--accent-text)',
            cursor: 'pointer', marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {t.title}
          </div>
        ))}
      </div>
      
      {/* 时间格子 */}
      <div style={{ position: 'relative', height: 24 * HOUR_PX }}>
        {/* 当天时间线 */}
        {isToday && (
          <div style={{ position: 'absolute', left: 0, right: 0,
            top: currentMin * (HOUR_PX / 60),
            height: 2, background: 'var(--p1)', zIndex: 2 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--p1)',
              position: 'absolute', left: -4, top: -3 }} />
          </div>
        )}
        
        {/* 每小时点击区 */}
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} onClick={() => onSlotClick(h)}
            style={{ position: 'absolute', left: 0, right: 0,
              top: h * HOUR_PX, height: HOUR_PX,
              borderBottom: '1px solid var(--border-soft)',
              cursor: 'pointer' }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
          />
        ))}
        
        {/* 有时间的任务 */}
        {tasks.map(t => {
          const [hh, mm] = (t.due_time || '00:00').split(':').map(Number)
          const top = hh * HOUR_PX + mm * (HOUR_PX / 60)
          return (
            <div key={t.id} onClick={() => onOpenTask(t)}
              style={{ position: 'absolute', left: 4, right: 4, top, minHeight: 24,
                background: 'var(--accent-soft)', color: 'var(--accent-text)',
                borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer',
                zIndex: 1, overflow: 'hidden' }}>
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              <div style={{ fontSize: 10 }}>{t.due_time}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

`getNowMinutes` 工具函数：
```typescript
const getNowMinutes = () => {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}
```

**步骤 5 — CreatePanel（时间槽点击后创建任务）**
```typescript
const [createSlot, setCreateSlot] = useState<{ date: string; time: string } | null>(null)

// 在 CalendarView 末尾（与 taskModal 并列）：
{createSlot && (
  <div className="modal-scrim" onClick={() => setCreateSlot(null)}>
    <div className="modal-card" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>新任务</div>
      <input autoFocus placeholder="任务名称…" id="create-title"
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 12px', fontSize: 14, marginBottom: 8 }} />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        {DateU.human(createSlot.date)} {createSlot.time}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn-ghost" onClick={() => setCreateSlot(null)}>取消</button>
        <button className="btn-primary" onClick={async () => {
          const title = (document.getElementById('create-title') as HTMLInputElement).value.trim()
          if (!title) return
          await api.addTask({ title, due_date: createSlot.date, due_time: createSlot.time, project_id: 'inbox' })
          setCreateSlot(null)
          fetch()
        }}>创建</button>
      </div>
    </div>
  </div>
)}
```

**辅助工具函数（在 `client/src/utils/date.ts` 中补充）**：
```typescript
// 加减月份
addMonths: (s: string, n: number): string => {
  const d = DateU.parse(s)
  d.setMonth(d.getMonth() + n)
  return DateU.fmt(d)
}

// 获取当周7天
weekDates: (s: string): string[] => {
  const d = DateU.parse(s)
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1  // 周一为0
  const monday = new Date(d)
  monday.setDate(d.getDate() - dow)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return DateU.fmt(day)
  })
}
```

**验收测试**：
```bash
# 打开日历页面，期望默认显示月视图（含任务 pill）
# 点击"周"→ 显示当前周 7 列时间轴
# 点击"日"→ 显示今天单列时间轴
# 时间轴上有红色当前时间指示线
# 有 due_time 的任务（"回复审稿意见邮件 16:00"）在周/日视图对应时间位置显示
# 点击时间轴空白区域 → 弹出创建面板，预填日期和时间
# 月视图格子内有任务 pill，>3 条显示 +N
```

---

## Phase 6 — 体验补全

---

### P6-001  TaskGroup 可折叠

**问题**：TodayView 的 overdue/today/done 分组无折叠交互，参考设计有 chevron 可折叠。  
**文件**：新建 `client/src/components/TaskGroup.tsx`，改 `client/src/views/Views.tsx`

**修改方案**：

新建 `client/src/components/TaskGroup.tsx`：
```typescript
import { useState, ReactNode } from 'react'
import { Icon } from '../icons'

interface TaskGroupProps {
  title: string
  count: number
  defaultOpen?: boolean
  accentColor?: string
  children: ReactNode
}

export function TaskGroup({ title, count, defaultOpen = true, accentColor, children }: TaskGroupProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
          cursor: 'pointer', userSelect: 'none', marginBottom: open ? 6 : 0 }}>
        <Icon name="chevron-right" size={14}
          style={{ color: accentColor || 'var(--text-tertiary)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600,
          color: accentColor || 'var(--text-secondary)' }}>{title}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)',
          background: 'var(--bg-inset)', borderRadius: 9, padding: '0 6px' }}>{count}</span>
      </div>
      {open && children}
    </div>
  )
}
```

在 `Views.tsx` 的 `TodayView` 里用 `<TaskGroup>` 包裹三组（先 import 组件）：
```typescript
import { TaskGroup } from '../components/TaskGroup'

// overdue 组
<TaskGroup title="逾期" count={overdue.length} accentColor="var(--p1)" defaultOpen={true}>
  {overdue.map(t => <TaskRow key={t.id} task={t} ... />)}
</TaskGroup>

// today 组
<TaskGroup title="今天" count={todayTasks.length} defaultOpen={true}>
  {todayTasks.map(t => <TaskRow key={t.id} task={t} ... />)}
</TaskGroup>

// done 组
<TaskGroup title="已完成" count={done.length} defaultOpen={false}>
  {done.map(t => <TaskRow key={t.id} task={t} ... />)}
</TaskGroup>
```

**验收**：
- 今日视图三个分组各有 chevron，点击折叠/展开
- 默认"已完成"分组折叠，其他展开
- 折叠后 children 不渲染（节省 DOM）

---

### P6-003  Sidebar 项目视图切换（board/list） — ✅ DONE

**问题**：侧栏点击项目只能进入默认视图（list），无法快速切换 board/list。  
**文件**：`client/src/components/Sidebar.tsx`

**修改方案**：在项目行 hover 时显示 board/list 图标按钮：
```typescript
// 在项目行容器中，已有点击 setRoute 的逻辑
// 增加 useState 管理 hoveredProject
const [hoveredProj, setHoveredProj] = useState<string | null>(null)

// 项目行：
<div
  onMouseEnter={() => setHoveredProj(proj.id)}
  onMouseLeave={() => setHoveredProj(null)}
  style={{ display: 'flex', alignItems: 'center', ... }}>
  
  {/* 项目名（点击进入当前视图或 list 默认）*/}
  <span onClick={() => setRoute({ view: 'list', projectId: proj.id })} style={{ flex: 1, ... }}>
    {proj.name}
  </span>
  
  {/* hover 时显示视图切换按钮 */}
  {hoveredProj === proj.id && (
    <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
      <button className="btn-icon" style={{ width: 20, height: 20 }}
        title="列表视图"
        onClick={() => setRoute({ view: 'list', projectId: proj.id })}>
        <Icon name="list" size={12} />
      </button>
      <button className="btn-icon" style={{ width: 20, height: 20 }}
        title="看板视图"
        onClick={() => setRoute({ view: 'board', projectId: proj.id })}>
        <Icon name="board" size={12} />
      </button>
    </div>
  )}
</div>
```

**注意**：需确认 `Icon` 中存在 `"board"` 和 `"list"` 名称，若不存在使用 `"columns"` / `"align-left"` 替代。

**验收**：
- 鼠标悬停在侧栏项目上 → 出现 list/board 图标按钮
- 点击 board 图标 → 路由切换到看板视图
- 点击 list 图标 → 路由切换到列表视图

---

## Phase 7 — Plane 参考功能（待讨论决定优先级）

> 以下功能来自 `../plane/` 参考，PM 和用户讨论后决定是否加入执行列表。

| 功能 | Plane 参考位置 | 说明 | 复杂度 |
|------|----------------|------|--------|
| **Cycle（冲刺/周期）** | `apps/web/core/store/cycle/` | 时间盒，把任务圈入一个周期，有进度统计 | 中 |
| **表格视图（Spreadsheet）** | TanStack Table + `issue-layouts/spreadsheet/` | 所有任务用表格展示，内联编辑 | 高 |
| **Activity log** | `IssueActivityStore` | 任务 modal 底部显示修改历史 | 中 |
| **批量操作** | `IssueUpdateBulk` | 多选任务批量改优先级/状态/日期 | 低 |
| **Pragmatic DnD** | `@atlaskit/pragmatic-drag-and-drop` | 替换当前 HTML5 drag，体验更好 | 低 |
| **Optimistic update** | MobX runInAction 模式 | 不换 MobX，只用 useState 做乐观更新 | 低-中 |

> **建议讨论顺序**：先做 Cycle（对个人规划最有价值），再讨论 Activity log。
> 不建议做：多工作区、Webhook 规则引擎、富文本 Pages、Burn-down 图表。

---

## Phase 7 — Plane 参考功能移植

> 参考来源：`../plane/apps/web/core/store/` 和 `../plane/packages/types/`

---

### P7-001  Cycle（冲刺/周期） — ✅ DONE

**功能描述**：用户可以创建一个有开始/结束日期的"冲刺"，把来自任何项目的任务拉进来，形成一个时间盒。Sidebar 显示当前活跃 Cycle，查看 Cycle 内任务进度。

**DB 变更**（需 PM 确认）：

在 `server/src/db.ts` 的 `db.exec` 里追加：
```sql
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cycle_tasks (
  cycle_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (cycle_id, task_id),
  FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

**Server 新路由**：新建 `server/src/routes/cycles.ts`，挂载到 `app.use('/api/cycles', cycleRoutes())`

API：
```
GET    /api/cycles                    → 全部 cycles（按 start_date 排序）
POST   /api/cycles                    → 创建（body: name, start_date, end_date）
PATCH  /api/cycles/:id                → 更新
DELETE /api/cycles/:id                → 删除（cascade 删 cycle_tasks）
GET    /api/cycles/:id/tasks          → 该 cycle 内所有任务（JOIN tasks）
POST   /api/cycles/:id/tasks          → 加任务进 cycle（body: task_id）
DELETE /api/cycles/:id/tasks/:task_id → 从 cycle 移除任务
```

**Client 改动**：

1. `client/src/api.ts`：加 Cycle CRUD 和 cycle_tasks 的 fetch 封装

2. `client/src/components/Sidebar.tsx`：在 Projects 下方加 "冲刺" section
   - 显示当前活跃 cycle（today 在 start_date～end_date 范围内）
   - 点击进入 CycleView

3. 新建 `client/src/views/CycleView.tsx`：
   - 显示 cycle 内任务列表
   - 顶部：cycle 名称、日期区间、完成进度条（completed/total）
   - 右侧"添加任务"：搜索框弹出所有未完成任务，点击加入 cycle
   - 每行任务右侧有"移出冲刺"按钮（×）
   - QuickComposer 创建任务并自动加入当前 cycle

4. Sidebar 加 "+ 新建冲刺" 按钮，弹出简单表单（名称 + 起止日期）

**验收测试**：
```bash
# 创建 cycle
CYCLE_ID=$(curl -s -X POST http://localhost:3001/api/cycles \
  -H 'Content-Type: application/json' \
  -d '{"name":"本周冲刺","start_date":"2026-06-09","end_date":"2026-06-15"}' | jq -r .id)

# 加任务进 cycle
TASK_ID=$(curl -s http://localhost:3001/api/tasks | jq -r '.[0].id')
curl -s -X POST http://localhost:3001/api/cycles/$CYCLE_ID/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\"}"

# 查询 cycle 内任务
curl -s http://localhost:3001/api/cycles/$CYCLE_ID/tasks | jq 'length'
# 期望：1

# UI：Sidebar 出现"冲刺"section，点击进入 CycleView 显示任务
```

---

### P7-002  Activity Log（任务修改历史） — ✅ DONE

**功能描述**：每次对任务的字段修改都记录一条 activity，在 TaskModal 底部显示"谁在什么时候把什么字段从 X 改成了 Y"。个人工具里"谁"就是"你自己"，所以只记录字段、旧值、新值、时间。

**DB 变更**（需 PM 确认）：

在 `server/src/db.ts` 追加：
```sql
CREATE TABLE IF NOT EXISTS task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

**Server 改动**：

1. `server/src/routes/tasks.ts`，在 PATCH handler 里，更新成功后写入 activity：
```typescript
// PATCH /api/tasks/:id 更新后
for (const f of changedFields) {
  const oldVal = (oldTask as any)[f]
  const newVal = body[f]
  if (String(oldVal) !== String(newVal)) {
    req.db.prepare(
      'INSERT INTO task_activities (id,task_id,field,old_value,new_value,created_at) VALUES (?,?,?,?,?,?)'
    ).run(uid(), req.params.id, f, String(oldVal ?? ''), String(newVal ?? ''), now())
  }
}
```

2. 同样在 `toggle` handler 里写入 `completed` 字段的 activity。

3. 新增路由：`GET /api/tasks/:id/activities` → 按 created_at DESC 返回最近 50 条

**Client 改动**：

`client/src/components/TaskModal.tsx`：在 modal 底部（Delete 按钮下方）加 Activity 区块：

```typescript
// 组件内加 activities state
const [activities, setActivities] = useState<Activity[]>([])
useEffect(() => {
  api.getTaskActivities(taskId).then(setActivities).catch(() => {})
}, [taskId])

// 渲染（仅当 activities.length > 0 时显示）
{activities.length > 0 && (
  <div style={{ marginTop: 20, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 8 }}>修改记录</div>
    {activities.map(a => (
      <div key={a.id} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', gap: 6 }}>
        <span style={{ color: 'var(--text-tertiary)' }}>{DateU.human(a.created_at.slice(0,10))}</span>
        <span>将 <b>{FIELD_LABELS[a.field] || a.field}</b> 从
          <code style={{ background: 'var(--bg-inset)', borderRadius: 3, padding: '0 3px' }}>{a.old_value || '空'}</code>
          改为
          <code style={{ background: 'var(--bg-inset)', borderRadius: 3, padding: '0 3px' }}>{a.new_value || '空'}</code>
        </span>
      </div>
    ))}
  </div>
)}
```

FIELD_LABELS 映射（中文字段名）：
```typescript
const FIELD_LABELS: Record<string, string> = {
  title: '标题', description: '描述', priority: '优先级',
  due_date: '截止日期', due_time: '截止时间', completed: '完成状态',
  labels: '标签', project_id: '项目', section_id: '分区', repeat: '重复'
}
```

**`client/src/api.ts` 新增**：
```typescript
getTaskActivities: (taskId: string) =>
  request<Activity[]>(`/api/tasks/${taskId}/activities`)
```

**验收测试**：
```bash
# 创建任务
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试活动记录"}' | jq -r .id)

# 修改优先级
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"priority":1}'

# 查询 activity
curl -s http://localhost:3001/api/tasks/$TASK_ID/activities | jq '.[0]'
# 期望：{"field":"priority","old_value":"4","new_value":"1",...}

# UI：打开任务 modal，底部显示"将优先级从 4 改为 1"
```

---

### P7-003  批量操作（Bulk Actions） — ✅ DONE

**功能描述**：在列表/收件箱视图，可以多选任务，然后批量修改优先级、截止日期、项目，或批量删除/完成。参考 Plane 的 `IssueUpdateBulk`。

**DB 变更**：不需要（用现有 PATCH 接口批量调用）

**Server 新接口**：`POST /api/tasks/bulk`

在 `server/src/routes/tasks.ts` 加：
```typescript
// POST /api/tasks/bulk
// body: { ids: string[], updates: Partial<Task> }
router.post('/bulk', (req: Request, res: Response) => {
  const { ids, updates } = req.body
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' })
  
  const fields = ['project_id', 'section_id', 'priority', 'labels', 'due_date', 'completed', 'completed_at']
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  
  for (const f of fields) {
    if (f in updates) {
      sets.push(`${f} = ?`)
      params.push(f === 'labels' ? JSON.stringify((updates as any)[f]) : (updates as any)[f])
    }
  }
  
  if (sets.length === 1) return res.json({ updated: 0 })
  
  const placeholders = ids.map(() => '?').join(',')
  req.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id IN (${placeholders})`)
    .run(...params, ...ids)
  
  res.json({ updated: ids.length })
})
```

**Client 改动**：

1. `client/src/components/TaskRow.tsx`：加 `selectable` 和 `selected` props，显示 checkbox 多选

2. 新建 `client/src/components/BulkActionBar.tsx`：底部浮动 action bar（当 selectedIds.length > 0 时显示）

```typescript
export function BulkActionBar({ ids, onDone, onClear }: {
  ids: string[]; onDone: () => void; onClear: () => void
}) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center',
      gap: 10, boxShadow: '0 4px 20px rgba(0,0,0,.15)', zIndex: 500
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>已选 {ids.length} 条</span>
      
      <button className="btn-ghost" onClick={async () => {
        await api.bulkUpdate(ids, { completed: 1, completed_at: new Date().toISOString() })
        onDone()
      }}>✓ 全部完成</button>
      
      <button className="btn-ghost" onClick={async () => {
        await api.bulkUpdate(ids, { priority: 1 })
        onDone()
      }}>🔴 设为 P1</button>
      
      <select style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px' }}
        onChange={async (e) => {
          if (!e.target.value) return
          await api.bulkUpdate(ids, { due_date: e.target.value })
          onDone()
        }}>
        <option value="">设置截止日期…</option>
        <option value={DateU.today()}>今天</option>
        <option value={DateU.addDays(DateU.today(), 1)}>明天</option>
        <option value={DateU.addDays(DateU.today(), 7)}>下周</option>
      </select>
      
      <button className="btn-ghost" style={{ color: 'var(--p1)' }} onClick={async () => {
        if (!confirm(`确认删除 ${ids.length} 条任务？`)) return
        await Promise.all(ids.map(id => api.deleteTask(id)))
        onDone()
      }}>🗑 删除</button>
      
      <button className="btn-icon" onClick={onClear} style={{ width: 24, height: 24 }}>✕</button>
    </div>
  )
}
```

3. 在 `InboxView`、`TodayView`、`ListView` 里加 `selectedIds` state 和 `BulkActionBar`：
```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

// 任务行：长按或 Shift+Click 触发多选（简化版：只做点击选中）
// 给 TaskRow 传：
<TaskRow
  selectable
  selected={selectedIds.has(t.id)}
  onSelect={(id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })}
  ...
/>

{selectedIds.size > 0 && (
  <BulkActionBar
    ids={[...selectedIds]}
    onDone={() => { setSelectedIds(new Set()); fetch() }}
    onClear={() => setSelectedIds(new Set())}
  />
)}
```

**`client/src/api.ts` 新增**：
```typescript
bulkUpdate: (ids: string[], updates: Partial<Task>) =>
  request('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ ids, updates }) })
```

**验收测试**：
```bash
# 批量更新优先级
TASK_ID1=$(curl -s http://localhost:3001/api/tasks | jq -r '.[0].id')
TASK_ID2=$(curl -s http://localhost:3001/api/tasks | jq -r '.[1].id')

curl -s -X POST http://localhost:3001/api/tasks/bulk \
  -H 'Content-Type: application/json' \
  -d "{\"ids\":[\"$TASK_ID1\",\"$TASK_ID2\"],\"updates\":{\"priority\":1}}"
# 期望：{"updated":2}

# 验证
curl -s http://localhost:3001/api/tasks/$TASK_ID1 | jq .priority
# 期望：1

# UI：在收件箱点击任务行左侧 checkbox → 底部浮出 BulkActionBar
# 点击"全部完成" → 所有选中任务立即消失
```
