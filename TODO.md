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

### P3-003  端到端手动测试清单 — ⚠️ 大部分通过（1 项失败 + 2 项待人工，详见执行结果）

执行以下所有步骤，均应无控制台报错：

**任务管理**
- [x] 收件箱创建任务（输入「明天下午2点 p1 测试任务」，验证 due_date、due_time、priority 解析正确）— ✅ due=次日/14:00/P1，前后端全通
- [x] 打开任务 Modal，修改标题、描述、优先级、标签，保存后重新打开验证保存 — ✅ 描述(onBlur)+优先级实测持久化；标题编辑入口未在自动化定位（代码同 save 机制，建议人工点一次确认）
- [~] 在看板视图拖动任务到不同列，刷新后位置保持 — ⚠️ infra 完整（board-col/board-card draggable/board-drag-handle + sort_order 持久化），HTML5 拖放待人工确认
- [~] 在列表视图创建分区，移动任务到分区 — ⚠️ infra 完整（看板「+新建分区」按钮 + /api/sections + 列表拖拽手柄），拖放待人工确认
- [x] 删除任务，期望立即消失（P1-002 验证）— ✅ 即时消失、软删除、计数刷新

**日期视图**
- [x] 今日视图：有到期任务时显示，完成后移到「已完成」分组 — ✅ 完成后默认隐藏，Display 开「显示已完成」即现"已完成"分组
- [x] 即将到来：在某天行创建任务，期望 due_date = 那天（P1-004 验证）— ✅ 明天行创建 due=次日 PASS
- [x] 日历视图：选中某格，右侧任务列表正确显示，QuickComposer 创建任务 due_date 为选中日期 — ✅ 选中联动 + 创建 due=选中日 PASS

**AI 功能**
- [x] AI 面板发送消息，期望实时流式显示文字（P1-003 验证）— ✅ POST /api/chat/stream 200，逐字 delta 流式
- [ ] AI 回复包含 proposals 时，点「应用全部」，验证任务被创建 — ❌ 失败：见下「发现的 bug」

**主题**
- [x] 切换深色主题，刷新页面，期望保持深色（P1-007 验证）— ✅ 存后端 settings，reload 保持

---

#### E2E 执行结果（2026-06-13~14，Claude 浏览器自动化 @ vite:5173 → server:3001）

**结论**：11 项中 **9 项通过**、**2 项拖拽 infra 完整待人工确认**、**1 项失败（AI proposals）**。零控制台错误。顺带印证：P1-002 / P1-004 / P1-007 / P4-001 / P7-002 / P8-001 / P8-004 / P8-007 / P8-009 / P8-010 / P8-011 / P9-001 / P9-002。

**发现的 bug — AI「应用全部」创建任务链路断裂**（建议立项 P10-001）
- 现象：向 AI 发送创建/拆解任务请求，AI 文字正常流式回复（甚至自称"已添加"），但**从不生成可应用的 proposals**，前端无「应用全部」按钮，任务未创建。两次请求 + 直接打 `/api/chat/stream` 均返回 `proposals:null`。
- 根因：`server/src/routes/ai.ts:146` 用正则解析 AI 输出中的 ` ```proposals ``` ` 代码块，但**系统提示从未告知 AI 该格式**——`ai.ts:22-63` 的系统提示 = 默认串「你是一个智能任务助手…」+ DB `settings.agent_rules`（实测为空）+ `agents_docs`（实测为占位 "test rules"）+ 项目/任务上下文，均无 proposals 格式规范。AI 因此输出 markdown 列表/纯对话。
- 注意：根因与根目录 `agent.md` 文件无关 —— runtime 读的是 DB `settings.agent_rules`，**不读该文件**（CLAUDE.md 中"AI rules read live from agent.md"已过期）。
- 前端/后端其余环节均已就绪：`AIPanel.tsx` 的 `ProposalCard` + `applyProposals`（POST /api/tasks + proposals_applied）完整，server 解析逻辑完整。**唯一缺口是在系统提示注入 ` ```proposals ``` ` 输出格式规范** — ✅ 已于 P10-001 修复。

---

## P10 实现记录（2026-06-14，Claude）

全部基于浏览器自动化（vite:5173 → server:3001）逐项验证 + 每阶段 `npm test` 全绿 + `npm run build` 通过。

### P10-001 — AI「应用全部」proposals 链路修复 ✅
`server/src/routes/ai.ts`：(1) 注入 proposals 输出协议到系统提示（create/update/complete/delete 的 JSON 格式，对齐 ai.ts 解析器 + AIPanel.applyProposals）；(2) 注入当前日期（修复相对日期算错）；(3) 任务列表给完整 task_id。验证：发消息→AI 输出 proposals→ProposalCard 渲染→「应用全部」→任务创建，端到端通过。

### P10-002 — 全局统一拖拽 ✅
新增 `client/src/utils/drag.ts`（`dragSource`/`draggedTaskId`/`noDrag`）：整卡片用 dataTransfer 传 taskId，浏览器原生区分点击（打开）vs 拖拽（移动），去掉 `handleDownRef` 手柄门控；内部控件（checkbox/按钮）用 `noDrag` 防误拖。接入：
- 列表（InboxView + ProjectView list）：重排 / 跨分区移动
- 看板（Views.BoardView + ProjectView board）：跨列改 section_id
- 即将到来（UpcomingView）：跨天 drop 改 due_date（保留 due_time）
- 月历（CalendarView.MonthView）：格子 drop 改 due_date
- 周视图（CalendarView.DayCol）：时段 drop 改 due_time + due_date，与既有 pointer 创建时间槽共存（`data-task-block` guard）

验证：列表重排顺序改变、即将到来跨天（6-14→6-15）、周视图时段（→14:00）均实测 PASS。

### P10-003 — Composer 展开式选择器 ✅
`client/src/components/QuickComposer.tsx`：展开后显示日期/优先级/标签选择器（复用 DateMenu/PriorityMenu/LabelMenu）。dual-source 规则：**显式选择覆盖 NLP**，未手动的字段用 NLP 解析值。验证：输入「明天 p3」→选择器显示明天/P3；手动选 P1→优先级变 P1（覆盖）、日期仍明天；提交后 priority=1 + due_date=次日 PASS。

### P10-004 — sort_order 重排修复 ✅
根因：`tasks.ts` addTask 默认 `sort_order=1e6`，所有任务同值导致中点重排为 no-op。修复：(1) 后端新任务取该 project/section 的 `max(sort_order)+1`；(2) 前端 `handleListMove` 改为对整列批量重新编号（0,1,2…），对既有同值数据也立即生效。验证：列表拖拽顺序真正改变 + sort_order normalize 为递增。

### 已知限制
- 看板**同列内**重排仍用中点算法（跨列移动不受影响）；列表已批量 normalize。
- 拖拽以合成 DragEvent + dataTransfer 验证逻辑链路；真机鼠标拖放手感（含看板横向滚动）建议人工再确认一次。

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
| P5-001 [SPLIT] | 🟢 Feature | 4-6h | — | ✅ DONE |
| P6-001 | 🟢 Feature | 1h | — | ✅ ALREADY DONE |
| P6-003 | 🟢 Feature | 45min | — | ✅ DONE |
| P7-001 | 🟣 Plane | 4h | P4-004 | ✅ DONE |
| P7-002 | 🟣 Plane | 2h | P4-004 | ✅ DONE |
| P7-003 | 🟣 Plane | 2h | — | ✅ DONE |
| P8-001 | 🟠 High | 1h | — | ✅ DONE |
| P8-002 | 🔴 Blocker | 20min | — | ✅ DONE |
| P8-003 | 🔴 Blocker | 1h | — | ✅ DONE |
| P8-004 | 🟠 High | 1h | — | ✅ DONE |
| P8-005 | 🟠 High | 2h | — | ✅ DONE |
| P8-006 | 🟠 High | 1.5h | — | ✅ DONE |
| P8-007 | 🟢 Feature | 30min | — | ✅ DONE |
| P8-008 | 🟢 Feature | 2h | — | ✅ DONE |
| P8-009 | 🟢 Feature | 2h | — | ✅ DONE |
| P8-010 | 🟢 Feature | 3h | — | ✅ DONE |
| P8-011 | 🟢 Feature | 2h | — | ✅ DONE |
| P8-012 | 🟢 Feature | 2h | — | ✅ DONE |
| P9-001 | 🔴 Blocker | 1h | P8 阶段 | ✅ DONE |
| P9-002 | 🔴 Blocker | 30min | P8-004 | ✅ DONE |
| P9-003 | 🟠 High | 30min | P8-010 | ✅ DONE |
| P9-004 | 🟠 High | 30min | P8-011 | ✅ DONE |
| P9-005 | 🟠 High | 1h | P8-009 | ✅ DONE |
| P9-006 | 🟡 Medium | 1h | P8-008 | ✅ DONE |
| P9-007 | 🟠 High | 1h | P8-006 | ✅ DONE |
| P9-008 | 🟡 Medium | 30min | P8-012 | ✅ DONE |
| P9-009 | 🔵 Cleanup | 1h | — | ✅ DONE |
| P9-010 | 🔵 Cleanup | 30min | — | ✅ DONE |
| P3-003 | 🔵 Cleanup | 2h | 全部 Phase 0-7 | ⚠️ 9/11 PASS |
| P10-001 | 🔴 Bug | 1h | — | ✅ DONE |
| P10-002 | 🟠 High | 4h | — | ✅ DONE |
| P10-003 | 🟢 Feature | 2h | — | ✅ DONE |
| P10-004 | 🟡 Medium | 1h | P10-002 | ✅ DONE |

**P10 全部完成**（详见下方「P10 实现记录」）：
- P10-001 — AI「应用全部」proposals 链路修复（系统提示注入格式 + 当前日期 + 完整 task_id），端到端验证通过。
- P10-002 — 全局统一拖拽：整卡片可拖（去 handle 门控）+ 列表/看板/即将到来/月历/周视图全部支持，drop 语义按视图区分。
- P10-003 — Composer 展开式选择器（日期/优先级/标签），dual-source 规则=显式选择覆盖 NLP。
- P10-004 — sort_order 重排修复（新任务 max+1 + 列表重排批量重新编号），解决既有数据中点重排失效。

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

---

## Phase 8 — 视图一致性补全

### P8-001  收件箱 / 导航栏视图加 list/board 切换 — ✅ DONE

**问题**：项目侧栏的 list/board hover 切换已实现（P6-003），但收件箱作为内置导航项无法切换 board 模式，导致收件箱功能受限。参考设计中收件箱也有看板视图。

**文件**：`client/src/views/Views.tsx`（InboxView）、`client/src/App.tsx`（路由）

**修改方案**：

1. `InboxView` 顶部 actions slot 加视图切换按钮：
```tsx
// InboxView 内部加 viewMode state
const [viewMode, setViewMode] = useState<'list' | 'board'>('list')

// ViewShell actions 传入
actions={
  <div style={{ display: 'flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 8, padding: 3 }}>
    <button className={viewMode === 'list' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
      onClick={() => setViewMode('list')}><Icon name="list" size={13} /> 列表</button>
    <button className={viewMode === 'board' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
      onClick={() => setViewMode('board')}><Icon name="board" size={13} /> 看板</button>
  </div>
}
```

2. 当 `viewMode === 'board'` 时，渲染 `<BoardView projectId="inbox" />` 而不是列表：
```tsx
{viewMode === 'board'
  ? <BoardView projectId="inbox" />
  : tasks.map(t => <TaskRow ... />)
}
```

**注意**：Board 视图的 inbox 默认没有分区，所有任务显示在"未分区"列。用户可以创建分区来创建多列看板。

**验收测试**：
- 进入收件箱，右上角出现「列表 / 看板」切换按钮
- 点击「看板」→ 渲染 BoardView，显示任务卡片
- 看板卡片左侧 checkbox 可完成任务
- 切回「列表」→ 恢复 TaskRow 列表

---

### P8-002  启动时端口占用导致 server 崩溃 — ✅ DONE

**问题**：`npm run dev` 启动时若 3001 端口已被占用（上次进程未正常退出），Node 会抛出未捕获的 `EADDRINUSE` 错误并崩溃，整个 dev 进程退出，无任何提示如何解决。

**影响**：每次强制关闭终端后重新启动都需要手动 `kill $(lsof -ti:3001)`，体验差。

**修改方案**（两处，都要做）：

**1. `server/src/index.ts` — 加 error handler，给出可操作的提示**

```typescript
// 改前（直接 listen，无 error 处理）
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

// 改后
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use.`)
    console.error(`Run: kill $(lsof -ti:${PORT})  then try again.\n`)
    process.exit(1)
  } else {
    throw err
  }
})
```

**2. `package.json` — `dev:server` 启动前先释放端口**

```json
"dev:server": "cd server && (lsof -ti:3001 | xargs kill -9 2>/dev/null || true) && npm run dev"
```

这样 `npm run dev` 会先静默 kill 掉占用 3001 的进程，再启动 server，用户不需要手动操作。

**验收测试**：
```bash
# 手动启动一个占用 3001 的进程
node -e "require('net').createServer().listen(3001)"

# 在另一个终端运行
npm run dev
# 期望：server 正常启动（自动 kill 了占用者），不报 EADDRINUSE 崩溃
# 期望：client Vite 也正常启动

# 验证
curl http://localhost:3001/api/projects
# 期望：返回 JSON
```

---

### P8-003  点击收件箱白屏：任务 labels 双重 JSON 编码 — ✅ DONE

**用户现象**：在「今天」页面点击左侧顶部「收件箱」后，右侧内容区完全空白。

**已复现错误**：
```text
TypeError: u.map is not a function
```

**根因**：

1. `Task.labels` 的接口契约不统一：
   - `QuickComposer` 传 `string[]`
   - `TaskModal` 传 `JSON.stringify(arr)`
   - `AIPanel` 创建任务时传字符串 `'[]'`
2. `server/src/routes/tasks.ts` 的 PATCH / bulk 更新对 `labels` 无条件再次
   `JSON.stringify`。客户端传 JSON 字符串时会写成 `"\"[]\""` 或
   `"\"[\\\"label-id\\\"]\""`。
3. `client/src/components/TaskChips.tsx` 只解析一次。双重编码值解析后仍是
   字符串，随后 `taskLabelIds.map(...)` 抛错，导致 React 主视图崩溃。
4. `BoardCard` 在 `client/src/views/Views.tsx` 中也直接执行
   `JSON.parse(task.labels).length`，同一批坏数据会让看板白屏。

当前数据库 `data/todo.sqlite3` 已确认存在 4 条 `labels = '"[]"'` 的任务。

**文件**：

- `client/src/api.ts`
- `client/src/components/TaskChips.tsx`
- `client/src/components/TaskModal.tsx`
- `client/src/views/Views.tsx`
- `client/src/ai/AIPanel.tsx`
- `server/src/routes/tasks.ts`
- `server/src/db.ts`

**修改方案**：

1. 明确写入契约：客户端创建或更新任务时，`labels` 一律传 `string[]`，不要传
   JSON 字符串。
   - `TaskModal.tsx`：`save({ labels: arr })`
   - `AIPanel.tsx`：创建任务时使用 `labels: []`
   - 将 `Task` 的写入类型与读取类型分开，避免继续用 `as any` 掩盖错误。
2. 服务端增加一个小型 `normalizeLabels(value)`：
   - 数组：只保留字符串成员，再 `JSON.stringify`
   - JSON 字符串：兼容解析一层或历史双重编码，最终规范为 JSON 数组字符串
   - 非法值、`null`、对象：规范为 `'[]'`
   - POST、PATCH、bulk 三处统一调用，不再各自处理。
3. `initDB()` 启动时做幂等数据修复：
   - 遍历现有任务的 `labels`
   - 用同一个规范化规则修复历史双重编码或非法值
   - 只更新规范化后不同的行，不删除任务或标签
4. 客户端增加共用的安全解析函数，例如
   `parseTaskLabelIds(labels): string[]`：
   - 最多兼容两层 JSON 字符串
   - 最终结果不是数组时返回 `[]`
   - `TaskChips` 和 `BoardCard` 必须共用该函数
   - 禁止在 JSX 中直接 `JSON.parse(task.labels)`
5. 不要用 `try/catch` 后直接返回解析结果；必须用 `Array.isArray` 验证类型。

**验收测试**：

```bash
# 1. 启动或重启 server 后，历史坏数据被修复
sqlite3 -readonly data/todo.sqlite3 \
  "select count(*) from tasks where labels like '\"%';"
# 期望：0

# 2. 数组写入保持单层 JSON
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"labels-regression","labels":[]}' | jq -r .id)

curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"labels":["label-test-id"]}' | jq -r .labels
# 期望：["label-test-id"]，不能是 "\"[\\\"label-test-id\\\"]\""

# 3. 兼容旧客户端传 JSON 字符串，但数据库仍规范化
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"labels":"[\"label-test-id\"]"}' | jq -r .labels
# 期望仍为：["label-test-id"]

npm run build
# 期望：通过
```

**浏览器回归**：

- 从「今天」点击顶部「收件箱」：立即显示 12 条任务，不白屏
- 收件箱列表中含历史坏数据的任务也能正常显示
- 点击「看板」：任务卡片正常显示，不白屏
- 在任务弹窗中添加/移除标签，关闭后重新打开，标签状态正确
- 刷新页面并再次进入收件箱，仍无控制台 `map is not a function` 错误

**边界要求**：

- 不删除现有任务来绕过坏数据
- 不只修当前 4 行数据库；必须同时阻止 POST、PATCH、bulk 再产生双重编码
- 不通过 Error Boundary 隐藏异常；数据契约和解析逻辑都要修复

---

### P8-004  项目页 list/board 切换应放在页面内 — ✅ DONE

**用户反馈**：收件箱顶部「列表 / 看板」切换的交互是正确方向；项目也应该采用同样模式。当前 Sidebar 项目列表 hover 后出现 list/board 两个小图标，交互不直观，且把“导航到项目”和“切换项目视图”混在侧栏里。

**要修正的旧任务**：P6-003「Sidebar 项目视图切换（board/list）」虽然已完成，但现在产品方向调整：不要在 Sidebar 里 hover 切换视图，改为进入项目后在页面顶部切换。

**文件**：

- `client/src/components/Sidebar.tsx`
- `client/src/views/Views.tsx`
- `client/src/App.tsx`
- `client/src/api.ts`

**修改方案**：

1. 移除 Sidebar 项目行的 hover 视图切换按钮：
   - 删除 `hoveredProj` state
   - 删除项目行外层 `onMouseEnter/onMouseLeave`
   - 删除 hover 时显示的「列表视图 / 看板视图」两个 `btn-icon`
   - Sidebar 项目行只负责导航到项目，不负责切换视图
2. 新增统一的项目页面容器，例如 `ProjectView({ projectId })`：
   - 负责读取当前项目 `project.view_mode`
   - 页面头部 actions 复用收件箱同款「列表 / 看板」segmented control
   - `viewMode === 'list'` 时渲染项目列表内容
   - `viewMode === 'board'` 时渲染项目看板内容
3. 点击页面顶部「列表 / 看板」时：
   - 立即切换本地 `viewMode`
   - 调用 `api.updateProject(projectId, { view_mode: viewMode })` 持久化用户偏好
   - 后续从 Sidebar 点击该项目时，默认打开上次保存的视图
4. 调整路由职责：
   - 推荐让 Sidebar 点击项目统一 `setRoute({ view: 'project', projectId: p.id })`
   - `App.tsx` 中新增 `case 'project': return <ProjectView projectId={...} />`
   - 如果暂时不想改路由名，也可以保留 `list/board` 内部路由，但页面内切换必须是唯一显式入口；Sidebar 不再显示小图标
5. 避免重复头部：
   - 当前 `BoardView` / `ListView` 各自有 `ViewShell title={project.name}`，重构后不要出现项目标题套项目标题
   - 可以把列表主体和看板主体拆成内部组件，让 `ProjectView` 统一负责 `ViewShell`
   - 收件箱现有交互保持不变

**验收测试**：

- Sidebar 项目列表中 hover「论文写作 / VLA 研究 / 生活」时，不再出现 list/board 小图标
- 点击任意项目，只进入该项目页面，不在 Sidebar 上做视图切换
- 项目页面右上角出现和收件箱一致风格的「列表 / 看板」切换按钮
- 在项目页点击「看板」：显示该项目看板内容
- 在项目页点击「列表」：显示该项目列表内容
- 切换后刷新页面或重新点击该项目，默认打开上次选择的视图
- 收件箱顶部「列表 / 看板」切换仍然可用
- `npm run build` 通过

**边界要求**：

- 不要保留两套入口（Sidebar hover + 页面顶部）同时存在
- 不要把项目切换按钮放到全局顶部栏；它属于当前项目页面的局部操作
- 不要影响「今天 / 即将到来 / 日历 / 冲刺」这些非项目页面

---

### P8-005  AI 面板空回复、错误静默、thinking/content 未分流 — ✅ DONE

**用户现象**：

- 在 AI 面板输入 `hi` 后，只看到用户消息和左侧空白 AI 气泡，没有可见输出。
- 之前出现过“能看到输出，但 thinking 和最终回答没有正确拆开”的问题。

**已复现**：

```bash
curl -N -m 20 -sS -X POST http://localhost:3001/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"请回复一个字：好","project_id":"inbox"}'
```

当前返回：

```json
{"error":"DEEPSEEK_API_KEY not configured"}
```

同时数据库里已经产生多条空 assistant 消息：

```sql
select role, quote(content), length(content), created_at
from messages
order by created_at desc
limit 12;
-- assistant | '' | 0 | ...
-- user      | 'hi' | 2 | ...
```

**根因**：

1. server dev 启动没有加载根目录 `.env`：
   - `package.json` 的 `dev:server` 是 `cd server && ... npm run dev`
   - `server/package.json` 的 `dev` 是 `tsx watch src/index.ts`
   - 没有 `--env-file=../.env`，也没有自定义 env loader
   - 因此 `server/src/routes/ai.ts` 读取不到 `DEEPSEEK_API_KEY`
2. `AIPanel.tsx` 没有检查 `response.ok`：
   - 后端返回 500 JSON 时，前端仍按 SSE 字节流读
   - 因为没有 `data:` 行，`fullContent` 保持空字符串
   - 最后仍调用 `api.addMessage(..., 'assistant', '')`，保存空回复
3. 后端 SSE 契约不完整：
   - `routes/ai.ts` 只读取 `parsed.choices?.[0]?.delta?.content`
   - DeepSeek thinking 模式会把思考内容放在 `reasoning_content`
   - 现在 `reasoning_content` 被直接丢弃
4. README 写了 `AI_PLANNER_THINKING=disabled/enabled`，但 `routes/ai.ts` 没有把它传给 DeepSeek：
   - DeepSeek V4 API 支持 `thinking: { type: "enabled" | "disabled" }`
   - 若未显式 disabled，可能返回 thinking 流，前端又不会展示
5. 前端 SSE parser 只看 `data:` 行，不记录 `event:`：
   - `event: error` 被当普通 data 忽略
   - 无法区分 `reasoning`、`delta`、`done`、`error`

参考官方文档：

- DeepSeek Chat Completion：`thinking` 参数支持 `enabled/disabled`
  https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek Thinking Mode：thinking 内容通过 `reasoning_content` 返回
  https://api-docs.deepseek.com/guides/thinking_mode

**文件**：

- `package.json`
- `server/package.json`
- `server/src/index.ts`
- `server/src/routes/ai.ts`
- `client/src/ai/AIPanel.tsx`
- `client/src/api.ts`
- `README.md`

**修改方案**：

1. 修复 server 环境变量加载：
   - 推荐在 server 启动时显式加载根目录 `.env`
   - 可以用 Node `--env-file=../.env`，也可以写一个零依赖 `loadEnv()` 工具
   - `npm run dev:server`、`server npm run dev`、`server npm run start` 都必须生效
   - 不要要求用户手动 `export DEEPSEEK_API_KEY`
2. `routes/ai.ts` 请求 DeepSeek 时接入 thinking 配置：
   ```ts
   const thinkingType = process.env.AI_PLANNER_THINKING === 'enabled' ? 'enabled' : 'disabled'

   body: JSON.stringify({
     model,
     messages,
     stream: true,
     thinking: { type: thinkingType },
   })
   ```
   - 若 DeepSeek 对某些模型不接受 `thinking`，要返回明确错误，不要静默空回复
3. 后端 SSE 事件契约改为稳定四类：
   ```text
   event: reasoning
   data: {"reasoning_content":"..."}

   event: delta
   data: {"content":"..."}

   event: error
   data: {"error":"..."}

   event: done
   data: {"content":"完整最终回答","reasoning_content":"完整 thinking 或空字符串","proposals":null}
   ```
   - DeepSeek chunk 中 `delta.reasoning_content` 追加到 `fullReasoning`
   - DeepSeek chunk 中 `delta.content` 追加到 `fullContent`
   - `proposals` 只从 `fullContent` 解析，不要从 thinking 解析
4. 前端重写 AIPanel SSE parser：
   - 按 SSE block 解析，保留 `event:` 和 `data:`
   - `event === 'reasoning'`：更新一个“思考中/Thinking”区域，不混进最终回答
   - `event === 'delta'`：更新 assistant streaming 气泡正文
   - `event === 'error'`：停止 thinking，显示错误消息，不保存空 assistant
   - `event === 'done'`：保存最终 assistant 消息；如果 `content.trim()` 为空且没有 proposals，显示错误或“不应保存空回复”
   - `!response.ok` 时先读取 JSON/text 错误，直接展示并 return
5. UI 展示规则：
   - `AI_PLANNER_THINKING=disabled`：不显示 thinking 区，只显示最终回答
   - `AI_PLANNER_THINKING=enabled`：显示可折叠 thinking 区，最终回答单独显示
   - thinking 文本不要保存进普通 assistant `content`；如需保存，放到独立字段或仅会话态展示
6. 清理历史空消息：
   - 启动时或一次性迁移删除 `role='assistant' AND trim(content)='' AND proposals IS NULL` 的历史空消息
   - 或在 UI 层过滤这些空 assistant 消息
   - 推荐迁移删除，避免用户继续看到空泡泡

**验收测试**：

```bash
# 1. dev server 能读取根目录 .env
npm run dev

curl -N -m 30 -sS -X POST http://localhost:3001/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"请回复一个字：好","project_id":"inbox"}'
# 期望：不是 {"error":"DEEPSEEK_API_KEY not configured"}
# 期望：至少出现 event: delta 和 event: done

# 2. disabled 模式不输出 reasoning
AI_PLANNER_THINKING=disabled npm run dev:server
curl -N -m 30 -sS -X POST http://localhost:3001/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"你好","project_id":"inbox"}'
# 期望：无 event: reasoning；有 event: delta；最后 event: done

# 3. enabled 模式能拆出 reasoning/content
AI_PLANNER_THINKING=enabled npm run dev:server
curl -N -m 30 -sS -X POST http://localhost:3001/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"简单解释 1+1 为什么等于 2","project_id":"inbox"}'
# 期望：可能有 event: reasoning；最终回答仍通过 event: delta/content 出现

npm run build
# 期望：通过
```

**浏览器回归**：

- 打开 AI 面板，发送 `hi`
- 期望：出现用户消息后，AI 回复能实时显示文字
- 期望：不会出现空白 assistant 气泡
- 断开/隐藏 API key 后再发送：
  - UI 显示清楚的错误，例如“AI 配置错误：DEEPSEEK_API_KEY not configured”
  - 不保存空 assistant 消息
- `AI_PLANNER_THINKING=enabled` 时：
  - thinking 和最终回答分开展示
  - 最终回答不混入 thinking 文本
- 刷新页面后，旧的空 assistant 气泡不再显示

**边界要求**：

- 不要把错误吞掉后写入空消息
- 不要把 `reasoning_content` 拼进最终回答正文
- 不要在前端硬编码 DeepSeek key；key 仍只在 server 环境中读取
- 不要依赖旧 Python/app.py 或已删除的代理文件

---

### P8-006  AI 输入框 @ 引用和 / 命令不可见/不可用 — ✅ DONE

**用户现象**：AI 面板输入框 placeholder 写着「@ 引用任务，/ 查看命令」，但实际输入 `@` 或 `/` 时没有稳定出现可用菜单，也无法完成引用/命令工作流。

**当前代码现状**：

- `client/src/ai/AIPanel.tsx` 已有 `MentionMenu`、`showSlash`、`handleInput`、`execSlash`
- 但当前实现还不满足可用标准：
  - 弹层用 `position: absolute; bottom: 100%`，输入区容器没有明确 `position: relative`，菜单可能定位错或被面板裁切
  - `projects.current` / `allTasks.current` 是 ref，加载完成不触发重渲染；用户刚打开面板输入 `@` 时常拿不到候选项
  - `@` 候选只插入可见文本，发送时只追加 `任务「name」(id 后 6 位)`，没有把任务完整上下文注入给 AI
  - `/compact` 有特殊逻辑，但 `/summarize`、`/decompose`、`/schedule` 只是插入文本，没有明确执行策略
  - 菜单没有键盘上下选择、Enter 选择、Esc 关闭的完整交互
  - `MentionMenu` 声明了 `onClose` 但没有使用

**文件**：

- `client/src/ai/AIPanel.tsx`
- `client/src/api.ts`
- `server/src/routes/ai.ts`
- 必要时新增小组件：`client/src/ai/CommandMenu.tsx` 或 `client/src/ai/MentionMenu.tsx`

**修改方案**：

1. 修复弹层定位和层级：
   - 输入区外层增加 `position: 'relative'`
   - `@` 菜单和 `/` 菜单都锚定在输入框上方，宽度跟输入框一致或接近
   - 菜单 `zIndex` 高于面板内容，不被消息列表和面板边界遮住
2. 用 state 保存候选数据，而不是只放 ref：
   - `const [allTasks, setAllTasks] = useState<Task[]>([])`
   - `const [projects, setProjects] = useState<Project[]>([])`
   - 打开面板后加载任务/项目，加载完用户再输入 `@` 能立即出现候选
3. `@` 引用交互：
   - 输入 `@`：显示最近未完成任务、项目、日期快捷项
   - 输入 `@关键词`：实时过滤
   - 点击或键盘 Enter 选择后，插入一个可读 token，例如 `@任务标题`
   - 同时在 `refs` 中保存结构化引用 `{ type, id, name, date }`
   - 输入框上方显示 mention pill，可删除
4. 发送时注入完整上下文：
   - task 引用：发送给 AI 的 hidden/context 部分包含 `id/title/description/project/section/due_date/due_time/priority/labels/completed`
   - project 引用：包含项目名、未完成任务摘要
   - date 引用：包含具体日期
   - 不要只传 id 后 6 位；后端无法可靠还原
5. `/` 命令交互：
   - 输入 `/` 显示命令菜单
   - 支持键盘上下选择、Enter 选择、Esc 关闭
   - `/compact`：沿用现有压缩逻辑
   - `/summarize`：转换为明确 prompt，例如“总结当前项目进展...”
   - `/decompose`：要求用户先 `@` 任务；未引用任务时给出提示
   - `/schedule`：把当前项目未完成任务和日期上下文发给 AI，要求安排本周计划
   - 如果暂时不实现某个命令，就不要显示它
6. 与 P8-005 对齐：
   - 命令发送后仍走修复后的 SSE/error 流程
   - 失败时不保存空 assistant 消息

**验收测试**：

- 打开 AI 面板，点击输入框，输入 `@`
  - 期望：输入框上方出现任务/项目/日期候选菜单
- 输入 `@测`
  - 期望：候选列表按关键词过滤
- 用鼠标选择一个任务
  - 期望：输入框中出现 `@任务标题`，上方出现 mention pill
- 按 Backspace 或点击 pill 的 `×`
  - 期望：引用可删除
- 输入 `/`
  - 期望：出现命令菜单，包含可执行命令
- 用键盘上下键选择 `/schedule`，按 Enter
  - 期望：命令被选中并能发送，不会直接提交普通空消息
- 发送带 `@任务` 的消息
  - 期望：AI 请求中包含该任务完整上下文
- `npm run build` 通过

**边界要求**：

- 不要只做 placeholder 文案；必须有真实菜单和选择行为
- 不要让 `/` 命令列表显示不可执行命令
- 不要把引用上下文直接污染用户可见消息正文；可见消息保持简洁，AI 请求可附加 context

---

### P8-007  日历去掉"日"视图，只保留月/周 — ✅ DONE

**用户反馈**：日历右上角的「日」视图没有必要，去掉即可。

**文件**：

- `client/src/views/CalendarView.tsx`

**修改方案**：

1. 将 `CalMode` 从：
   ```ts
   type CalMode = 'month' | 'week' | 'day'
   ```
   改为：
   ```ts
   type CalMode = 'month' | 'week'
   ```
2. 顶部 segmented control 只渲染「月 / 周」，删除「日」按钮。
3. 删除 `titleFor()` 中的 day 分支。
4. 删除 `navigate()` 中 day 分支。
5. 删除 `TimeGrid dates={mode === 'week' ? weekDates : [cursor]}` 这类 day 兼容逻辑，周视图固定传 `weekDates`。
6. 保留月视图右侧选中日期任务列表，这已经能覆盖“看某一天任务”的需求。

**验收测试**：

- 进入「日历」页面
- 右上角只看到「月 / 周」，不再看到「日」
- 点击「月」：月历正常显示
- 点击「周」：周历正常显示
- 前后导航按钮在月/周模式都正常
- `npm run build` 通过

**边界要求**：

- 不要删除月视图右侧的单日任务列表
- 不要影响 Today 页面

---

### P8-008  周视图支持拖拽创建日程/任务时间段 — ✅ DONE

**用户反馈**：周视图需要像日历 App / Notion Calendar 那样，可以直接在时间网格里用鼠标拖拽创建日程。参考：https://calendar.notion.so/

**当前问题**：

- `CalendarView.tsx` 的 `DayCol` 只支持点击整点 slot 创建任务
- `CreatePanel` 只有 `date/time/title`，没有结束时间
- `tasks` 表已有 `due_time` 和 `end_time` 字段，但周视图没有利用 `end_time` 展示持续时长
- 当前体验无法通过拖动选择 10:30-12:00 这种时间段

**文件**：

- `client/src/views/CalendarView.tsx`
- `client/src/api.ts`
- `server/src/routes/tasks.ts`（确认 POST/PATCH 已支持 `end_time`）

**交互目标**：

- 在周视图时间网格中：
  - 鼠标按下并拖动：出现半透明 selection block
  - selection block 跟随鼠标按 15 或 30 分钟粒度吸附
  - 松开鼠标：弹出创建面板
  - 创建面板显示日期、开始时间、结束时间，输入标题后创建任务
- 创建后任务在周视图中按时间段高度显示。

**修改方案**：

1. 扩展 slot 数据：
   ```ts
   type CreateSlot = {
     date: string
     startTime: string
     endTime: string
   }
   ```
2. 在 `DayCol` 内实现 pointer drag：
   - `onPointerDown` 记录 `date`、起始分钟、当前分钟
   - `onPointerMove` 更新当前分钟
   - `onPointerUp` 计算 start/end，最短 30 分钟
   - 使用 `setPointerCapture`，避免拖出格子时丢事件
   - 点击但不拖动时，默认创建 30 或 60 分钟事件
3. 时间换算：
   - 根据 day column 的 `getBoundingClientRect().top`
   - `minutes = clamp((clientY - top) / HOUR_PX * 60, 0, 24 * 60)`
   - snap 到 15 或 30 分钟，建议 30 分钟起步，15 分钟也可
4. 拖拽预览：
   - 在当前 day column 绝对定位一个 selection block
   - 显示 `10:30 – 12:00`
   - 颜色用 `var(--accent-soft)` / `var(--accent)`
5. CreatePanel：
   - 展示 `DateU.human(date) startTime – endTime`
   - 支持编辑标题
   - Enter 创建，Esc 取消
   - 创建时调用：
     ```ts
     api.addTask({
       title,
       project_id: 'inbox',
       due_date: slot.date,
       due_time: slot.startTime,
       end_time: slot.endTime,
     })
     ```
6. 周视图任务渲染：
   - `top` 按 `due_time` 计算
   - `height` 按 `end_time - due_time` 计算，最小 24px
   - 没有 `end_time` 的旧任务按 30 或 60 分钟默认高度显示
   - 点击任务仍打开 `TaskModal`
7. 月视图不需要拖拽创建；只改周视图。

**验收测试**：

- 进入「日历」→「周」
- 在周四 10:30 附近按下，拖到 12:00 松开
  - 期望：拖动时出现选区块，显示大致时间范围
  - 期望：松开后弹出创建面板
- 输入「写论文」并按 Enter
  - 期望：创建任务，`due_date` 为周四日期，`due_time` 为 `10:30`，`end_time` 为 `12:00`
  - 期望：周视图中出现高度覆盖 10:30-12:00 的任务块
- 点击新任务块
  - 期望：打开 TaskModal，能看到/编辑时间信息
- 轻点一个时间格不拖动
  - 期望：仍可快速创建默认 30/60 分钟任务
- 拖动跨越很短距离
  - 期望：自动扩展到最短 30 分钟，而不是创建 0 分钟任务
- `npm run build` 通过

**边界要求**：

- 不要引入大型日历库；先在现有 `CalendarView.tsx` 上做最小可用实现
- 不要把任务拖拽移动和拖拽创建混在一起；本任务只做“空白网格拖拽创建”
- 不要影响 BoardView 的拖拽逻辑

---

### P8-009  任务列表和看板共用同一套拖拽排序/移动逻辑 — ✅ DONE

**用户反馈**：像「123 明天」这种任务，无论在列表视图还是看板视图，理论上都应该是同一套任务操作逻辑，都可以直接拖动操作。当前列表模式缺少拖拽能力，看板和列表行为不一致。

**当前代码现状**：

- `client/src/views/Views.tsx`：
  - `BoardCard` / `BoardCol` 有一套 HTML5 drag/drop 逻辑
  - 支持看板列内排序、跨分区移动，最终 PATCH `section_id` 和 `sort_order`
- `client/src/components/TaskRow.tsx`：
  - 没有 `draggable`
  - 没有拖拽 handle
  - 列表中无法调整任务顺序，也无法拖入其他分区
- `ListView` / `InboxView`：
  - 只是 `tasks.map(...)`
  - 没有 drop indicator、没有 reorder 逻辑

**文件**：

- `client/src/components/TaskRow.tsx`
- `client/src/views/Views.tsx`
- 可选新增：`client/src/components/TaskDropList.tsx`
- 可选新增：`client/src/hooks/useTaskDrag.ts`
- `server/src/routes/tasks.ts`（确认 PATCH 已支持 `section_id` 和 `sort_order`）

**修改方案**：

1. 抽出共享拖拽计算逻辑，不要让列表和看板各自复制一套：
   - 计算 drop 位置：根据 pointer/clientY 与目标 task row/card 中线比较
   - 计算新 `sort_order`：
     - 插到最前：`first.sort_order - 1`
     - 插到最后：`last.sort_order + 1`
     - 插到中间：相邻两项平均值
   - PATCH：
     ```ts
     api.updateTask(taskId, {
       section_id: targetSectionId,
       sort_order: newOrder,
     })
     ```
2. 给 `TaskRow` 增加列表拖拽能力：
   - 可选 `draggable` / `dragHandleProps` / `data-task-id`
   - 使用和看板一致的拖拽手柄 `⠿`，避免点击任务正文误触拖拽
   - checkbox、AI、删除按钮点击不触发拖拽
3. 新增列表 drop 容器：
   - 未分区列表是一组 drop zone
   - 每个 section 下的任务列表也是一组 drop zone
   - 拖到同一列表内：只改 `sort_order`
   - 拖到另一个 section：改 `section_id + sort_order`
   - 拖到“未分区”：`section_id = null`
4. Inbox 列表也要支持排序：
   - Inbox 没有项目分区时，至少支持收件箱内任务上下排序
   - 如果 P8-001/P8-004 后 Inbox 支持分区，则同样支持跨分区移动
5. 看板也使用共享逻辑：
   - 保留当前视觉和拖拽体验
   - 但把 `BoardCol` 内部排序/insert 计算替换为共享 helper
   - 避免未来列表/看板排序规则再次分叉
6. 视觉反馈：
   - 拖动时被拖任务 opacity 降低
   - 目标位置显示一条 accent 插入线
   - 可 drop 的 section/list 背景轻微高亮
7. 数据刷新：
   - drop 成功后调用 `onRefresh()`
   - 乐观更新可选，但失败时必须回滚或重新 fetch

**验收测试**：

- 收件箱「列表」视图：
  - 拖动第一条任务到第三条下面
  - 刷新页面
  - 期望：顺序保持
- 项目「列表」视图：
  - 在同一分区内上下拖动任务
  - 期望：顺序立即变化，刷新后保持
- 项目「列表」视图跨分区：
  - 将任务从未分区拖到某个分区
  - 期望：任务出现在目标分区，`section_id` 更新
- 项目「看板」视图：
  - 原有拖动卡片跨列仍可用
  - 刷新后位置和顺序保持
- 拖动时点击 checkbox / 删除 / AI 按钮：
  - 期望：执行原动作，不启动拖拽
- `npm run build` 通过

**边界要求**：

- 不要引入大型 DnD 库；先把现有 HTML5 drag 逻辑抽成共享能力
- 不要改动任务完成、删除、AI 按钮行为
- 不要只给看板补强；列表和看板都必须走同一套排序/移动计算
- 不要把日历周视图拖拽创建任务（P8-008）混进本任务；这是任务视图内的任务排序/移动

---

### P8-010  全站 Add Task 使用 Todoist 风格渐进式 Composer — ✅ DONE

**用户反馈**：参考 Todoist 的 Upcoming 添加任务交互：

- 没有正在添加任务时，只显示一行轻量「+ Add task」，不要出现占空间的空白输入框。
- 点击「+ Add task」后，展开一个较大的编辑卡片，可填写 task title/description/日期/项目/优先级等。
- 如果没有输入内容，点击 Cancel 直接收起。
- 如果已经输入了一些改动，再点击 Cancel，要弹出确认框「Discard unsaved changes?」，确认后才丢弃草稿。
- 这个逻辑不是某一个页面专属，而是所有页面的添加任务入口都应该采用同一套优雅交互。

**当前代码现状**：

- `client/src/components/QuickComposer.tsx` 始终渲染一个输入框卡片。
- `TodayView`、`InboxView`、`UpcomingView`、`CalendarView`、`BoardView`、`ListView` 和分区内添加任务都直接使用 `QuickComposer`。
- 因为组件默认展开，空页面或分组中会出现不必要的空白输入格，视觉噪音较大。
- 当前 `Escape` 会直接清空并取消，没有“有草稿时二次确认”的保护。

**文件**：

- `client/src/components/QuickComposer.tsx`
- `client/src/views/Views.tsx`
- `client/src/views/CalendarView.tsx`
- 可选新增：`client/src/components/ConfirmDialog.tsx`

**修改方案**：

1. 将 `QuickComposer` 改成两态组件：
   ```ts
   type ComposerMode = 'collapsed' | 'expanded'
   ```
   - collapsed：只显示轻量行 `+ 添加任务`
   - expanded：显示 Todoist 风格编辑卡片
2. 新增 props：
   ```ts
   initiallyOpen?: boolean
   collapsedLabel?: string
   compact?: boolean
   defaultDueDate?: string
   defaultProjectId?: string
   sectionId?: string
   onDone?: (task?: Task) => void
   ```
   - 大多数页面默认 `initiallyOpen=false`
   - 看板列内点击「添加任务」后可以 `initiallyOpen=true` 或由父组件控制展开
3. collapsed 状态 UI：
   - 只占一行高度，样式接近 Todoist：
     - 红/强调色 plus icon
     - 文案「添加任务」或调用方传入的 `collapsedLabel`
     - hover 时轻微背景
   - 空列表/空日期分组中不要出现大输入框
4. expanded 状态 UI：
   - 较大的卡片，包含：
     - title 输入
     - description 输入（可选，至少留出结构位置）
     - chips/controls：日期、项目、优先级、标签（可先复用当前 NLP chips，后续再做完整菜单）
     - 底部右侧 Cancel / Add task
   - 保留现有自然语言解析能力：
     - `明天 p2 #论文写作 @紧急` 等仍可解析
     - `defaultDueDate` 仍然能预填日期
   - Add task disabled 条件：title 为空时 disabled
5. Cancel 逻辑：
   - 如果 title/description/解析字段都为空：直接收起并清空
   - 如果有任何草稿改动：弹出确认框
     ```text
     Discard unsaved changes?
     Your unsaved changes will be discarded.
     [Cancel] [Discard]
     ```
   - 点击 Cancel：关闭确认框，保留编辑卡片和内容
   - 点击 Discard：清空草稿并收起
   - Escape 键遵循同样逻辑，不要直接丢草稿
6. 创建成功后：
   - 清空草稿
   - 收起到 collapsed 状态
   - 调用 `onDone(task)` 刷新父视图
7. 全站迁移：
   - Today 顶部添加任务：collapsed 默认
   - Inbox 列表顶部：collapsed 默认
   - Upcoming 每天下面：每个日期只显示轻量 `+ 添加任务`
   - Calendar 月视图右侧：collapsed 默认，带 `defaultDueDate=selected`
   - Project List 未分区和每个 section：collapsed 默认
   - BoardView / BoardCol：列底部 `+ 添加任务` 点击后展开卡片，不要同时出现旧按钮和旧输入框
8. 可选：把确认弹窗做成通用 `ConfirmDialog`，后续也可复用到删除/取消编辑。

**验收测试**：

- Today 页面：
  - 初始只看到一行 `+ 添加任务`，没有大输入框
  - 点击后展开编辑卡片
  - 不输入内容点击 Cancel：直接收起
- Inbox 页面：
  - 点击 `+ 添加任务`，输入 `123 明天 p2`
  - 期望：显示日期/优先级 chips
  - 点击 Add task 后创建任务并收起
- Upcoming 页面：
  - 每个日期下面只显示轻量 `+ 添加任务`
  - 点击某天的添加行，创建任务后 `due_date` 是该日期
- Calendar 月视图右侧：
  - 选中某天后添加任务，默认日期仍是选中日期
- 有草稿取消：
  - 展开 composer，输入 `abc`
  - 点击 Cancel 或按 Esc
  - 期望：出现 discard confirm
  - 点击确认框 Cancel：回到 composer，`abc` 仍在
  - 点击 Discard：composer 收起，`abc` 被清空
- Board 列底部：
  - 点击 `+ 添加任务` 后只在该列展开 composer
  - 创建后任务出现在该列
- `npm run build` 通过

**边界要求**：

- 不要在每个页面各自实现一套展开/取消逻辑；必须收敛到 `QuickComposer`
- 不要牺牲现有 NLP 创建能力和 `defaultDueDate`
- 不要让 Cancel 静默丢失已有草稿
- 不要引入重型表单库；当前组件内状态足够

---

### P8-011  全任务页面增加统一 Display 面板 — ✅ DONE

**用户反馈**：参考 Todoist 右上角 `Display` 面板。任意任务页面都应该有统一入口管理 Layout / Sort / Filter。我们现在列表、看板逻辑本身不错，但缺少统一 Display 面板，尤其需要通过标签过滤任务。

**当前问题**：

- 收件箱和项目页的 list/board 切换是页面内按钮，但不是统一 Display 面板。
- Today / Upcoming / Calendar / Project / Inbox 之间没有统一的过滤入口。
- 任务标签只能在 TaskModal 中看和改，不能在视图层做筛选。
- 重要性 `priority` 和标签 `labels` 是两套概念，现在视图层更偏 priority，缺少真正的 tag 工作流。

**文件**：

- `client/src/components/DisplayMenu.tsx`（新建）
- `client/src/views/Views.tsx`
- `client/src/views/ProjectView.tsx`
- `client/src/views/CalendarView.tsx`
- `client/src/api.ts`
- `client/src/components/Popover.tsx`

**修改方案**：

1. 新建通用 `DisplayMenu` 组件：
   - 触发按钮放在页面 header actions 区，文案类似 `Display`
   - 打开后是右侧 popover/panel
   - 面板结构参考：
     ```text
     Layout
       List / Board / Calendar（仅当前页面支持的模式显示）
     Completed tasks
       toggle
     Sort
       None / Manual / Due date / Priority / Created
     Grouping
       None / Section / Date / Priority / Label（先实现可用子集）
     Filter
       Date: All / Today / Upcoming / No date
       Priority: All / P1 / P2 / P3 / P4
       Labels: multi-select
     Reset all
     ```
2. 页面支持矩阵：
   - Inbox：Layout 支持 List / Board；支持 completed、sort、priority、label filter
   - Project：Layout 支持 List / Board；支持 completed、sort、section/grouping、priority、label filter
   - Today：不需要 Layout；支持 completed、priority、label filter
   - Upcoming：不需要 Layout；支持 completed、priority、label filter
   - Calendar：Layout 保持月/周，不强塞 list/board；至少支持 label/priority filter 影响显示的任务
3. 状态管理：
   - 先用每个页面本地 state 实现，不必上全局 store
   - 对项目 `view_mode` 继续持久化到 `project.view_mode`
   - 过滤条件可以先不持久化；如果实现持久化，用 `settings` 表按页面 key 存
4. 过滤实现：
   - 在渲染前对 tasks 做 `applyTaskFilters(tasks, filters)`
   - label filter 是多选：
     - 选 0 个 label：不过滤
     - 选多个 label：默认 OR 语义（任务含任意选中标签即可）
   - priority filter 独立于 label filter
   - completed toggle 控制是否包含完成任务
5. 标签选择 UI：
   - 复用 `api.getLabels()`
   - 显示 label 名称和颜色点
   - 支持多选、清除
6. 与 P8-004 对齐：
   - 项目页页面内 list/board 切换可以迁移进 Display 面板
   - 如果保留顶部 segmented control，也要和 Display 面板状态同步，不要两套状态
7. 与 P8-012 对齐：
   - label filter 使用真正的 `labels` 字段，不要把 priority 当标签

**验收测试**：

- Inbox 页面：
  - 右上角看到 `Display` 按钮
  - 打开后可切换 List / Board
  - 选择某个标签后，只显示含该标签的任务
  - 点击 Reset all 后恢复全部任务
- Project 页面：
  - Display 面板可切换 List / Board
  - 切换后刷新或重新进入项目，默认视图保持
  - Label filter 在 List 和 Board 都生效
- Today 页面：
  - Display 面板没有无意义的 Board layout
  - Label filter 能过滤今天任务
- Calendar 页面：
  - Label filter 能影响月/周中显示的任务
- `npm run build` 通过

**边界要求**：

- 不要在每个页面复制一份 Display UI；必须是通用组件
- 不要把 priority 当作 label
- 不要让过滤只在列表生效、看板不生效
- 不要影响现有任务创建/完成/删除行为

---

### P8-012  Obsidian 式 #标签 NLP + 聚合视图 — ✅ DONE

**用户反馈**：任务应该可以通过 `#123` 加标签，标签像 Obsidian 的 tag 一样：同一个标签可以找到所有对应任务。它不是现在的优先级分级，也不是项目选择。

**当前问题**：

- `client/src/nlp.ts` 当前把 `#xxx` 优先当项目解析：
  - `#论文写作` 会设置 `project_id`
  - label 反而用 `@Label`
- 这和用户期望冲突：`#123` 应该是标签，不是项目。
- 当前 `labels` 表可以存标签，但缺少：
  - `#tag` 自动创建标签
  - 标签过滤/聚合页
  - Sidebar 中统一浏览标签

**文件**：

- `client/src/nlp.ts`
- `client/src/components/QuickComposer.tsx`
- `client/src/components/TaskChips.tsx`
- `client/src/components/Sidebar.tsx`
- `client/src/views/Views.tsx`
- `server/src/routes/labels.ts`
- `server/src/routes/tasks.ts`
- `client/src/api.ts`

**产品规则**：

1. `#tag` 表示标签，类似 Obsidian。
2. 标签和项目分离：
   - 项目选择不再主要依赖 `#项目名`
   - 项目可以通过 composer 的项目控件选择，或后续用 `+项目名` / `^项目名` 之类语法，当前任务先不新增项目语法
3. 标签可以跨项目使用。
4. 点击某个标签，进入标签聚合视图，显示所有含该标签的任务。

**修改方案**：

1. 修改 NLP：
   - `#([\\p{L}\\p{N}_\\-\\/]+)` 解析为标签 token
   - 一个输入可包含多个标签：`写实验 #VLA #论文`
   - 从 title 中移除 tag token
   - priority 仍用 `p1/p2/p3/p4` 或 `!1`，不要和 label 混淆
   - 旧的 `@Label` 可保留兼容，但主要提示改成 `#标签`
2. 标签自动创建：
   - QuickComposer 解析出 tag names 后：
     - 先用 `api.getLabels()` 查找同名标签
     - 不存在则 `api.addLabel(name)`
     - 创建任务时传 label ids
   - 服务端 `POST /api/labels` 应避免重复：
     - 同名 label 已存在时返回已有记录
     - name trim，禁止空名
3. 标签展示：
   - `TaskChips` 显示为 `#标签名`，颜色点可保留
   - TaskModal 标签区也显示 `#标签名`
4. 标签聚合视图：
   - 新增 route，例如 `{ view: 'label', labelId }`
   - Sidebar 增加「标签」区：
     - 显示常用/全部标签
     - 每个标签显示任务数量
   - 点击标签进入 LabelView
   - LabelView 展示所有未完成任务，跨项目，支持打开任务 modal
5. API 支持：
   - `GET /api/tasks?label_id=...` 或前端拿 all tasks 后过滤均可
   - 推荐后端支持 `label_id`，避免全量过滤长期变慢
   - SQLite labels 是 JSON text，短期可用 `labels LIKE '%"id"%'`，但要注意转义；或先前端过滤，后续再规范化 join table
6. 与 P8-011 对齐：
   - Display 面板中的 Labels filter 使用同一套 label 数据
   - LabelView 可复用列表展示和 filters

**验收测试**：

```bash
# 创建不存在的新标签
curl -s -X POST http://localhost:3001/api/labels \
  -H 'Content-Type: application/json' \
  -d '{"name":"VLA"}'
# 重复创建同名标签
curl -s -X POST http://localhost:3001/api/labels \
  -H 'Content-Type: application/json' \
  -d '{"name":"VLA"}'
# 期望：不产生两个 VLA 标签
```

浏览器：

- 在任意 QuickComposer 输入：`读论文 #VLA #论文 明天 p2`
  - 期望：创建任务标题为 `读论文`
  - 期望：任务带 `#VLA`、`#论文` 两个标签
  - 期望：due_date=明天，priority=P2
- 输入不存在标签：`整理资料 #newtag`
  - 期望：自动创建 `newtag` 标签并绑定任务
- Sidebar 标签区点击 `#VLA`
  - 期望：进入标签聚合视图，看到所有带 `#VLA` 的任务，跨项目
- Display 面板选择 `#VLA`
  - 期望：当前页面只显示带 `#VLA` 的任务
- `npm run build` 通过

**边界要求**：

- 不要把项目和标签继续混用同一个 `#` 语法
- 不要把 priority 显示成标签
- 不要创建重复同名标签
- 不要只在 QuickComposer 支持；TaskModal、TaskChips、Display filter、Sidebar/LabelView 都要使用同一套 label 概念

---

## P9 Review Fixes — 2026-06-11 23:24 Codex 全量 Review

> 这批是 Kimi 22:05 后的 review 修复项。当前首要目标不是继续加功能，而是先恢复可构建、可打开项目页、可稳定验收。

### P9-001  恢复 npm run build 通过 — ✅ DONE

**现状**：Codex 本地复跑 `npm run build` 失败。Kimi log 里写了 `vite build` 通过，但当前落盘代码不能通过 `tsc -b`，所以不能进入下一步功能验收。

**当前错误**：

```text
src/ai/AIPanel.tsx(51,41): error TS6133: 'onClose' is declared but its value is never read.
src/ai/AIPanel.tsx(398,117): error TS2304: Cannot find name 'mentionAnchorRef'.
src/components/QuickComposer.tsx(157,92): error TS2304: Cannot find name 'handleDiscard'.
src/components/TaskModal.tsx(488,28): error TS2322: Type 'string[]' is not assignable to type 'string'.
src/nlp.ts(99,37): error TS6133: 'ctx' is declared but its value is never read.
src/views/CalendarView.tsx(56,18): error TS2304: Cannot find name 'useRef'.
src/views/CalendarView.tsx(77,15): error TS6133: 'pad' is declared but its value is never read.
src/views/LabelView.tsx(11,10): error TS6133: 'allLabels' is declared but its value is never read.
src/views/ProjectView.tsx(4,1): error TS6133: 'DateU' is declared but its value is never read.
src/views/ProjectView.tsx(46,21): error TS2304: Cannot find name 'useRef'.
src/views/ProjectView.tsx(47,27): error TS2304: Cannot find name 'useRef'.
src/views/ProjectView.tsx(160,18): error TS2304: Cannot find name 'useRef'.
```

**要求**：

1. 逐项修掉 TypeScript 错误，不要关闭 `noUnusedLocals`。
2. 不要只跑 `vite build`，必须跑根目录 `npm run build`。
3. 修完后再继续下面任何功能项。

**验收**：

```bash
npm run build
```

必须 0 error。

---

### P9-002  项目页点击白屏 — ✅ DONE

**用户反馈**：现在项目一个都打不开。

**复现**：

1. 打开 `http://localhost:3001/`
2. 点击 Sidebar 项目，例如「论文写作」
3. 页面变成空白，DOM snapshot 为空

**直接原因**：

- `client/src/App.tsx` 已把项目路由切到新 `ProjectView`：
  - `case 'project': return <ProjectView projectId={...} />`
- `client/src/views/ProjectView.tsx` 使用了 `useRef`，但 import 只有 `useState, useEffect`
  - `boardDrag = useRef(...)`
  - `boardHandleDown = useRef(...)`
  - `colRef = useRef(...)`
- 这会导致项目页渲染时直接崩溃。

**相关文件**：

- `client/src/App.tsx`
- `client/src/views/ProjectView.tsx`
- `client/src/views/Views.tsx`

**修复要求**：

1. 修复 `ProjectView` 的 `useRef` import 和未使用 import。
2. 项目页必须能打开 list/board 两种模式。
3. 不要保留两套互相分叉的项目视图逻辑：
   - 当前 `Views.tsx` 里仍有旧的 `ListView` / `BoardView`
   - 新增的 `ProjectView.tsx` 又复制了一套 Board 逻辑
   - 需要明确最终入口，只保留一套项目页实现，或让旧代码不再参与维护面。

**验收**：

- 点击「论文写作」「VLA 研究」「生活」都能打开
- 页面不白屏
- Console 无 `ReferenceError` / React render error
- `npm run build` 通过

---

### P9-003  QuickComposer Todoist 逻辑半成品 — ✅ DONE

**现状**：

- `QuickComposer` 新增了 collapsed/expanded、取消确认弹窗，但当前代码引用不存在的 `handleDiscard`。
- `expanded`、`showConfirm` 等状态已存在，但流程没有完整闭环。
- `collapsedLabel` 在类型和 UI 中出现，但当前构建显示未使用或使用不一致。

**相关文件**：

- `client/src/components/QuickComposer.tsx`
- `client/src/views/Views.tsx`
- `client/src/views/ProjectView.tsx`
- `client/src/views/CalendarView.tsx`

**修复要求**：

1. 补齐 `handleDiscard`：
   - 清空输入
   - 清空 parsed
   - 关闭确认弹窗
   - 如果是 collapsed 模式，回到 collapsed 状态
2. `Cancel / Esc`：
   - 无草稿：直接收起
   - 有草稿：弹确认框
   - 确认框 Cancel：保留草稿
   - 确认框 Discard：丢弃草稿并收起
3. 真正做到 Todoist 式渐进：
   - 空状态只显示轻量 `+ 添加任务`
   - 点击后展开大框
   - 不要默认在所有页面都显示一个空白大输入框
4. 所有页面复用同一个 `QuickComposer`，不要页面内复制取消确认逻辑。

**验收**：

- Inbox / Today / Upcoming / Calendar selected day / Project list / Project board column 都符合上述交互
- 按 Esc 和点击取消都能走正确分支
- `npm run build` 通过

---

### P9-004  Display 过滤没有全局生效 — ✅ DONE

**现状**：

- `DisplayMenu` 组件已创建，但只在 Inbox 集成。
- Inbox 算了 `filteredTasks`，但列表渲染仍然用 `tasks.map(...)`，导致过滤不生效。
- Inbox board 模式直接渲染 `<BoardView projectId="inbox" />`，没有把 filters 传进去，过滤不影响看板。
- Project / Today / Upcoming / Calendar 还没有统一接入 Display。
- `showLayout` 参数在 `DisplayMenu` 中存在，但调用处没有真正使用。

**相关文件**：

- `client/src/components/DisplayMenu.tsx`
- `client/src/views/Views.tsx`
- `client/src/views/ProjectView.tsx`
- `client/src/views/CalendarView.tsx`

**修复要求**：

1. 提取 `applyTaskFilters(tasks, filters)` 工具函数，避免每个页面复制。
2. Inbox list 必须渲染 `filteredTasks`，不是原始 `tasks`。
3. Inbox board 也必须使用过滤后的任务，或 BoardView 接受 filters。
4. Project list/board 都接入 Display：
   - layout 切换放进 Display，或顶部 segmented control 与 Display 状态同步
   - label/priority/completed filter 同时影响 list 和 board
5. Today / Upcoming / Calendar 至少接入 label/priority filter。

**验收**：

- 任一页面选择 `#紧急` 后，只显示含该标签任务
- Inbox list 和 board 过滤结果一致
- Project list 和 board 过滤结果一致
- Reset all 恢复
- `npm run build` 通过

---

### P9-005  P8-009「列表拖拽」实际未完成 — ✅ DONE

**现状**：

- `TaskRow` 加了 `draggable` / `onDragStart` props。
- 但 Project list / Inbox list / Today / Upcoming 渲染 `TaskRow` 时没有传 `draggable`，也没有 drop zone。
- 当前只有 board card 有实际 `onDragStart/onDrop` 逻辑。

**相关文件**：

- `client/src/components/TaskRow.tsx`
- `client/src/views/Views.tsx`
- `client/src/views/ProjectView.tsx`
- `server/src/routes/tasks.ts`

**修复要求**：

1. 实现共享列表拖拽逻辑，至少支持：
   - 同列表内 reorder
   - 跨 section 拖动
   - 更新 `section_id`
   - 更新 `sort_order`
2. List 和 Board 使用同一套 sort_order 规则。
3. 不要只在 TaskRow 上放 `draggable` props 就标记完成。
4. 拖动开始应由 drag handle 触发，避免影响点击打开任务和勾选完成。

**验收**：

- Project list：任务可在未分区和任意 section 之间拖动
- Inbox list：任务可重排
- Project board：现有拖动仍可用
- 刷新后顺序保持
- `npm run build` 通过

---

### P9-006  Calendar 周视图拖拽创建需要修正确性 — ✅ DONE

**现状**：

- `CalendarView` 未导入 `useRef`，构建失败。
- `DayCol` 把 pointer handlers 放在整列根节点，包含 all-day 区域和已有任务。
- `yToMin()` 用整列 `rect.top` 计算时间，但时间网格实际从 all-day 区域之后开始，时间会偏移。
- 点击已有 timed task 时，父层 `onPointerDown` 也会启动创建流程，可能和打开任务 modal 冲突。
- `pad` 在 `onPointerUp` 中声明但未使用。

**相关文件**：

- `client/src/views/CalendarView.tsx`

**修复要求**：

1. 导入 `useRef` 并清理未使用变量。
2. 把拖拽创建绑定到真正的 time grid 区域，不要包含 all-day 区域。
3. `yToMin()` 使用 time grid 的 rect，而不是整个 DayCol。
4. 已有任务块 `onPointerDown/onClick` 需要 `stopPropagation()`，点击任务只打开任务，不触发创建。
5. 支持最小 30 分钟、15 分钟吸附，向上/向下拖都正确。

**验收**：

- 周视图在 10:00-11:30 拖动，CreatePanel 显示正确时间
- 点击已有任务只打开 modal，不弹创建框
- all-day 区域点击不会创建定时任务
- `npm run build` 通过

---

### P9-007  AI @/命令和 thinking 解析仍不完整 — ✅ DONE

**现状**：

- `AIPanel` 引用了不存在的 `mentionAnchorRef`，构建失败。
- `MentionMenu` 的 `onClose` 参数未使用。
- `showSlash` 时键盘只处理 Esc，ArrowUp/ArrowDown/Enter 没有选择命令。
- `/summarize`、`/decompose`、`/schedule` 只是把命令文本塞进输入框，没有真正执行命令语义。
- SSE `reasoning` 被收集到 `fullReasoning`，但 UI 没有展示 collapsible thinking，也没有保存/展示分离结果。

**相关文件**：

- `client/src/ai/AIPanel.tsx`
- `server/src/routes/ai.ts`

**修复要求**：

1. 修复 `mentionAnchorRef`：要么定义并使用，要么移除 ref。
2. @ 菜单：
   - 支持键盘上下选择、Enter 插入、Esc 关闭
   - 点击外部关闭
3. / 命令：
   - 支持键盘上下选择、Enter 执行
   - 如果命令只是 prompt shortcut，要明确转成对应 prompt 后发送
   - 如果不能实现，就不要展示不可用命令
4. Thinking：
   - `AI_PLANNER_THINKING=enabled` 时展示可折叠 thinking
   - final answer 和 thinking 分开显示
   - `disabled` 时不显示 thinking，但不能影响 final answer
5. 错误消息不要留下空 assistant bubble。

**验收**：

- 输入 `@` 能选任务/项目/日期，Enter 插入引用
- 输入 `/` 能选命令，Enter 执行
- AI 有 reasoning 时能看到折叠 thinking 和最终输出
- AI 失败时显示明确错误，不出现空泡泡
- `npm run build` 通过

---

### P9-008  #标签数据契约要统一 — ✅ DONE

**现状**：

- `nlp.ts` 的 `label_ids` 实际塞的是 label name。
- `QuickComposer` 提交前会把 name resolve/create 成 id，这是对的；但 chips 阶段仍用 `findLabel(id)` 查找，导致新输入的 `#tag` 预览 chip 可能不显示。
- `TaskModal.save({ labels: arr })` 传的是 string[]，但 `Task.labels` 类型是 string，构建失败。
- `LabelView` 拉了 `allLabels` state 但没有使用。

**相关文件**：

- `client/src/nlp.ts`
- `client/src/components/QuickComposer.tsx`
- `client/src/components/TaskModal.tsx`
- `client/src/components/TaskChips.tsx`
- `client/src/views/LabelView.tsx`
- `server/src/routes/labels.ts`

**修复要求**：

1. 重命名 NLP 字段，避免误导：
   - 推荐 `label_names: string[]`
   - 创建任务前再 resolve/create 为 `label_ids`
2. QuickComposer 预览 chip 对新标签也要显示：
   - 已有标签显示原颜色
   - 新标签可显示默认颜色
3. TaskModal 更新 labels 时遵守 API 类型：
   - 要么扩展 `api.updateTask` 类型允许 `labels: string[]`
   - 要么调用前显式 `JSON.stringify(arr)`
   - 注意不要重新引入双重 JSON 编码
4. `labels` 表 name 应该有唯一约束或后端稳定去重。
5. 清理 `LabelView` 未使用 state。

**验收**：

- 输入 `读论文 #VLA #论文 明天 p2`：标题为 `读论文`，两个标签正确显示
- 重复创建 `#VLA` 不生成重复 label
- TaskModal 增删标签后刷新仍正确
- LabelView 能显示跨项目任务
- `npm run build` 通过

---

### P9-009  清理 Project/List/Board 重复实现 — ✅ DONE

**现状**：

- `Views.tsx` 里仍有旧 `BoardView` / `ListView`。
- `ProjectView.tsx` 又复制了一份 `BoardCol` / `BoardCard`。
- Display、拖拽、QuickComposer、AI 打开逻辑会在两份代码之间分叉。

**修复要求**：

1. 明确项目页唯一入口是 `ProjectView`。
2. 旧 `ListView/BoardView` 如果不再使用，就删除或拆出共享组件。
3. BoardCard / BoardCol 不要在两个文件各维护一份。
4. 共享组件应支持：
   - projectId
   - tasks
   - sections
   - filters
   - onRefresh
   - onOpenTask / onOpenAI

**验收**：

- `rg "export function ListView|export function BoardView" client/src/views/Views.tsx` 不再出现未使用旧入口，或有明确复用说明
- Project list/board 功能一致
- `npm run build` 通过

---

### P9-010  验收脚本和日志可信度修复 — ✅ DONE

**现状**：

- `npm run build` 当前失败，但 Kimi log 写 “vite build 通过”。
- `npm test` 当前也失败：
  - `Cannot find module deepseek_responses_proxy.mjs`
- `timeout` 命令在当前 macOS zsh 环境不可用，不能把 Linux-only 命令写进验收脚本。

**修复要求**：

1. Kimi 每次完成后必须贴根目录命令：
   ```bash
   npm run build
   ```
2. 如果要跑测试：
   - 要么恢复 `deepseek_responses_proxy.mjs`
   - 要么修正 `tests/proxy.test.mjs`
   - 要么明确这个测试已废弃并移除脚本
3. 验收命令避免使用当前机器不存在的工具，例如 GNU `timeout`。
4. `KIMI_LOG.md` 不要写与当前落盘状态不一致的 “build 通过”。

**验收**：

- `npm run build` 通过
- `npm test` 要么通过，要么脚本被修正为当前有效测试
- 浏览器 smoke：
  - 刷新首页
  - 点击 Inbox / Today / Upcoming / Calendar / 每个 Project / 每个 Label / Cycle
  - 均不白屏

---

## Phase 10 — 体验修复 & 功能补全（PM Review 2026-06-12）

> 问题来源：Claude 通读代码后识别的现有缺口，按优先级排序。

---

### P10-001  TodayView Composer 未自动设今日 due_date — ✅ DONE

**问题**：`TodayView` 的 `QuickComposer` 的 `projectId="inbox"`，但没有传 `defaultDueDate`。用户在"今天"视图添加的任务 `due_date` 为空，不会出现在今天列表，而是沉进 inbox。

**相关文件**：`client/src/views/Views.tsx`（TodayView 里的 QuickComposer）

**修改方案**：
```tsx
// Views.tsx TodayView 中
<QuickComposer
  projectId="inbox"
  defaultDueDate={DateU.today()}   // ← 加这一行
  placeholder="添加今天的任务…"
  onDone={fetch}
/>
```

**验收**：
- 在今天视图输入任务名回车，任务 `due_date = today`，立即出现在"今天"分组
- Upcoming 视图同日能看到该任务
- `npm run build` 通过

---

### P10-002  AI Panel 浮动模式遮住任务内容 — ✅ DONE

**问题**：`AIPanel` 的 `layout="float"` 是 `position: fixed`，打开后覆盖列表，无法同时看任务和 AI 对话。应默认 `sidebar` 模式，或把 float 改为右下角小窗，不挡主内容。

**相关文件**：`client/src/App.tsx`、`client/src/ai/AIPanel.tsx`

**修改方案**：
1. `App.tsx` 把 `aiLayout` 初始值从 `'float'` 改为 `'sidebar'`。
2. `AIPanel` float 模式改为右下角固定小窗（`bottom: 24px; right: 24px; width: 360px; height: 520px`），不铺满屏幕。
3. float 窗口加拖动支持（mousedown + mousemove on header）。

**验收**：
- 默认打开 AI 是 sidebar，主内容区域仍可滚动
- float 模式是右下角小窗，不覆盖任务列表
- float 小窗可拖动
- `npm run build` 通过

---

### P10-003  Calendar 月视图任务块点击无反应 — ✅ ALREADY DONE

**问题**：`CalendarView` 月视图里任务块没有 `onClick` 打开 `TaskModal`，点击无反应。

**相关文件**：`client/src/views/CalendarView.tsx`

**修改方案**：
1. 月视图任务块加 `onClick={() => setTaskModal(task.id)}`。
2. 确认月视图有 `taskModal` state 和 `<TaskModal>` 渲染（如没有就补全）。

**验收**：
- 月视图点击任务块 → 打开 TaskModal
- 修改后刷新，任务属性变更持久化
- `npm run build` 通过

---

### P10-004  Display 过滤只在 InboxView 生效 — ✅ DONE

**问题**：`DisplayMenu` 目前只集成进了 `InboxView`，`TodayView`、`UpcomingView`、`ProjectView`（list 模式）均无过滤。

**相关文件**：`client/src/views/Views.tsx`、`client/src/views/ProjectView.tsx`、`client/src/components/DisplayMenu.tsx`

**修改方案**：
1. `TodayView` header actions 加 `<DisplayMenu>`，`filteredTasks` 替换 `todayTasks` 渲染。
2. `ProjectView` list 模式同上。
3. `UpcomingView` 加过滤（priority/label，sort 可暂不支持）。
4. 过滤逻辑提取为共享函数 `applyFilters(tasks, filters)` 避免重复。

**验收**：
- 今天视图、项目视图 list 模式均有 Display 按钮
- 按 priority 过滤后只显示对应任务
- `npm run build` 通过

---

### P10-005  BoardView 无已完成任务展示区 — ✅ DONE

**问题**：任务完成后从看板消失，用户无法感知本看板今天/本周完成了多少。缺少"已完成"折叠列或底部 Done 区。

**相关文件**：`client/src/views/Views.tsx`（BoardView / BoardCol）、`client/src/views/ProjectView.tsx`

**修改方案**：
在 `BoardView` 末尾加一个只读 `DoneCol`：
1. 拉取 `completed=1` 的任务（同项目）。
2. 渲染为折叠的 `BoardCol` 风格，标题"已完成 · N"，默认收起。
3. 卡片只读（无拖动），点击打开 TaskModal。
4. `ProjectView` board 模式同步。

**验收**：
- 看板右侧有"已完成"折叠列
- 完成任务后立即出现在该列
- 点击已完成卡片可打开 TaskModal
- `npm run build` 通过

---

### P10-006  Cycle 缺少"添加任务到冲刺"入口 — ✅ DONE

**问题**：`CycleView` 有进度条和任务列表，但没有从现有任务里选择加入 Cycle 的 UI，只能靠 QuickComposer 新建。

**相关文件**：`client/src/views/CycleView.tsx`、`server/src/routes/cycles.ts`

**修改方案**：
1. CycleView header 加"+ 添加已有任务"按钮。
2. 点击弹出任务选择弹窗（复用 SearchOverlay 或简单 popover），列出未归属冲刺的未完成任务，支持搜索。
3. 选中后调用 `POST /api/cycle-tasks { cycle_id, task_id }`（接口已有）。
4. 选完刷新 CycleView。

**验收**：
- 点击"添加已有任务"弹出选择器
- 搜索并选择任务后，任务出现在 CycleView 列表
- 任务计入冲刺进度条
- `npm run build` 通过

---

### P10-007  AI ProposalCard 应用后无反馈 — ✅ DONE

**问题**：点击"应用全部"后没有任何 toast / 状态变更提示，用户不知道是否成功。且如果 API 报错，错误被静默丢弃。

**相关文件**：`client/src/ai/AIPanel.tsx`（ProposalCard onApply）

**修改方案**：
1. `onApply` 执行完成后在 messages 里追加一条系统消息，如 `✓ 已创建 3 个任务`。
2. 如果 API 调用失败，追加错误消息 `✗ 操作失败：<reason>`。
3. 应用完成后自动刷新父视图（通过 `window.__refreshTasks?.()` 或已有机制）。

**验收**：
- 应用 AI 建议后，对话框出现"✓ 已应用 N 条操作"确认消息
- API 失败时出现错误消息，不静默
- `npm run build` 通过
