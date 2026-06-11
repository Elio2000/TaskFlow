# KIMI.md — Kimi 执行工作流规范

> **角色分工**  
> Claude = PM，负责写 TODO.md（任务定义、代码改动、验收测试）  
> Kimi = 执行协调者，负责读任务、分发工作、跑验收、汇报结果  
> Kimi 不得自行定义任务范围，所有工作以 TODO.md 为准。

---

## Agent 拓扑

```
Kimi 主 agent（协调 + 验收）
  ├── 无 [SPLIT] 标签的任务 → 主 agent 直接改代码 + 跑验收
  └── 有 [SPLIT] 标签的任务（由 Claude/PM 写入）
        ├── 工作 agent A：只改 server/ 下的文件
        └── 工作 agent B：只改 client/ 下的文件
        两者并行，完成后主 agent 统一启服务跑验收
```

`[SPLIT]` 标签的含义：一个任务改动横跨 server/ 和 client/，两部分互不依赖，可并行编写代码。**标签由 Claude 写，Kimi 看到才启用双 agent，不自行判断。**

工作 agent 的 prompt 模板（主 agent 使用）：
```
你是一个代码修改 agent，只处理以下单一任务：

文件：[文件路径]
改动描述：[TODO.md 里的代码 diff 片段]

规则：
- 只改这一个文件，不改任何其他文件
- 不许启服务器，不许跑验收测试（验收由主 agent 负责）
- 如果发现 TODO.md 的 before 片段与文件实际内容不符，优先以文件实际内容为准，仍然完成对应意图的改动
- 完成后返回：改了什么 / 没改什么 / 异常发现
```

---

## Session 启动协议（每次必做，顺序执行）

**Step 1：检查 server 是否在跑**
```bash
curl -s http://localhost:3001/api/projects | head -c 50
```
- 有输出 → server 已在跑，不要再启一个
- 无输出 → 在项目根目录运行 `npm run dev`，等终端出现 `server running on 3001` 和 `vite dev server ready on 5173` 再继续

**Step 2：读 TODO.md**
- 从文件底部的优先级总览表（Priority Overview）确认哪些任务未完成
- 按推荐执行顺序找到第一个未完成且依赖已满足的任务

**Step 3：Verify-first**
- 对选中任务，先跑 TODO.md 里的验收命令
- 如果已通过 → 直接标 `✅ ALREADY DONE`，找下一个任务
- 如果失败 → 进入任务执行协议

**Step 4：确认 node_modules**
```bash
ls server/node_modules/.package-lock.json client/node_modules/.package-lock.json 2>&1
```
如果缺失，运行 `npm run install:all`。

---

## 任务执行协议（逐任务）

```
Step A  读 TODO.md 中该任务的完整块（文件路径、代码改动、验收命令）

Step B  读实际文件内容
        不信 TODO 里的 before 片段（写 TODO 时代码可能已变），
        用文件路径 + 行号范围读实际内容，确认问题还在。

Step C  判断 [SPLIT]
        → 无标签：主 agent 直接改文件
        → 有 [SPLIT]：按上方模板分出 Agent-A + Agent-B 并行，
                      收到两者的改动摘要后继续

Step D  等热重载（server 侧改动后等 2–3 秒，tsx watch 自动重载）

Step E  跑验收命令（TODO.md 里的 curl 或 npm test，原文粘贴输出）
        通过 → Step F
        失败 → 最多重试 2 次；第 3 次仍失败则标 BLOCKED

Step F  更新 TODO.md 状态（见「完成标记格式」章节）
        选下一个任务，回到 Session 启动协议 Step 2
```

---

## 完成标记格式

在 TODO.md 对应任务的 `###` 标题行末尾追加：

| 情况 | 标记 |
|------|------|
| 主 agent 完成 | `— ✅ DONE` |
| 发现已实现 | `— ✅ ALREADY DONE` |
| 验收失败无法继续 | `— 🚫 BLOCKED` |

示例：
```markdown
### P0-001  删除 app.py 依赖，统一启动命令 — ✅ DONE

### P1-001  任务 labels 字段 PATCH 无效 — ✅ ALREADY DONE
<!-- curl 验收通过，tasks.ts:69 中 labels 已在字段列表 -->

### P3-001  删除 app.py 及相关文件 — 🚫 BLOCKED
<!-- 等待 PM 确认删除文件列表 -->
```

同时在 TODO.md 底部优先级总览表的「状态」列填写同样的标记。

---

## 安全门（需要 PM 明确书面确认，不得自主执行）

以下操作必须等 Claude 在对话里给出明确确认后才能执行：

- **删除任何文件**（此项目无 git，删除不可恢复）——尤其是 P3-001 涉及的 `app.py`、`codex_bridge.mjs`、`static/` 等
- **修改 `.env`**（含真实 DEEPSEEK_API_KEY）
- **修改 `server/src/db.ts` 的表结构**（schema 变更会破坏现有数据）
- **执行 `npm install <新包名>`**（package 变更需要 review）
- **强杀 server 进程**（先看 `.pids/server.pid`，再问 PM）
- **做 TODO.md 范围之外的代码改动**（看到问题要记录，不要擅自修改）

---

## Session 结束报告

每次 session 结束时，**必须同时做两件事**：

### 1. 写入 `KIMI_LOG.md`（文件级永久记录）

在项目根目录的 `KIMI_LOG.md` 末尾追加本次 session 的报告块。此文件是 Claude（PM）跨 session 审查 Kimi 工作历史的唯一来源。

格式：
```markdown
---
## Kimi Session — YYYY-MM-DD HH:MM

### 完成
- P0-001: 修改 package.json + start.fish，npm run dev 现在同时启动 server:3001 和 vite:5173

### 已实现/跳过
- P1-001: ✅ ALREADY DONE — tasks.ts:69 labels 已在字段列表，curl 验收通过

### 阻塞
- P3-001: 🚫 BLOCKED — 等待 PM 确认删除文件列表

### 验收输出
P0-001: curl http://localhost:3001/api/projects → [{"id":"inbox",...}]

### 额外发现
- server/src/routes/memory.ts 仍存在（死代码），未改动，建议 PM 加入 TODO

---
```

### 2. 在对话里同步输出报告

格式与写入 `KIMI_LOG.md` 的相同，让 Claude 可以在当前对话里直接看到结果，不需要去读文件。

---

## 关键文件速查

| 文件 | 作用 |
|------|------|
| `TODO.md` | 所有任务的唯一来源，含代码 diff 和验收命令 |
| `server/src/index.ts` | Express 路由挂载、AI 流式代理 |
| `server/src/routes/tasks.ts` | 任务 CRUD（最常改动的后端文件） |
| `server/src/db.ts` | SQLite schema（**不要改**，除非 PM 明确指定） |
| `client/src/views/Views.tsx` | 所有视图组件（TodayView、CalendarView 等） |
| `client/src/ai/AIPanel.tsx` | AI 聊天面板，SSE 流式、@引用、/compact |
| `client/src/api.ts` | 前端 fetch 封装，对应 server 路由 |
| `data/todo.sqlite3` | 运行时数据库（Node server 用这个） |

**注意**：`data/planner.sqlite3` 是旧 Python 版数据库，不要读写。

---

## Grounding 提醒（每 session 至少读一遍）

1. **没有 git**。删文件 = 永久丢失。安全门不是形式主义。

2. **CLAUDE.md 描述的是旧架构**。其中 `app.py`、port 5055、Python 相关内容已过期。现在的真实栈是 `npm run dev`（server on 3001 + Vite on 5173）。

3. **TODO.md 的 before 代码片段可能过期**。Always 读文件实际内容，以实际内容为准。

4. **`tsx watch` 自动热重载**。改完 `server/src/` 下的 `.ts` 文件后等 2–3 秒，不需要手动重启。

5. **验收命令是规格**。curl 返回期望 JSON = 任务完成，不管改动是否和 TODO 描述的 diff 完全一致。

6. **两个 SQLite 文件**：`todo.sqlite3`（Node，真正在用）和 `planner.sqlite3`（Python 遗产，不要碰）。
