# 用 Hermes（或任意 MCP 客户端）管理 TaskFlow 任务

TaskFlow 自带一个 **MCP server**（`server/src/mcp.ts`），把任务操作暴露成 MCP 工具。任何 MCP 客户端都能接入——比如 [Hermes Agent](https://hermes-agent.nousresearch.com)（跨 Telegram/Slack/Discord 等平台）。这样你在聊天里说一句话，Hermes 就能帮你查/建/改任务，数据落到 TaskFlow 同一个本地 SQLite，网页端（http://localhost:3001）实时可见。

分工：**TaskFlow = 任务存储 + 可视化网页 + MCP 工具源；Hermes = 跨平台对话大脑。**

## 前提（同机部署）

MCP server 是现有 REST API 的薄封装，所以 **TaskFlow 必须在运行**：

```bash
npm start            # 启动 TaskFlow，监听 http://localhost:3001
```

MCP server 与 TaskFlow 跑在同一台机器（stdio 接入，无需联网/鉴权）。

## 接入 Hermes

编辑 `~/.hermes/config.yaml`，在 `mcp_servers` 下加一段：

```yaml
mcp_servers:
  taskflow:
    command: "/Users/lixiangting/Elio/ai-planner-lite/server/node_modules/.bin/tsx"
    args: ["/Users/lixiangting/Elio/ai-planner-lite/server/src/mcp.ts"]
    env:
      TASKFLOW_API: "http://localhost:3001/api"
    tools:
      include: [list_tasks, create_task, update_task, complete_task, list_projects, create_project, plan_tasks]
```

- 路径换成你自己的仓库绝对路径。
- **直接指向 `tsx` 二进制**，不要用 `npm run`——`npm` 会往 stdout 打印日志，破坏 stdio MCP 协议。
- `tools.include` 只放了安全子集；想让 Hermes 也能删任务/打冲刺标记，加上 `delete_task` / `set_sprint`。
- 改完执行 `hermes mcp` 或运行时 `/reload-mcp` 生效。

### 更快启动（可选）

`tsx` 每次启动要现场编译 TS，有约 1–2 秒冷启动。若 Hermes 偶尔“识别不到任务工具”（多半是握手超时），或只想启动更快，可以预编译成普通 JS：

```bash
cd server && npm run build:mcp     # 产出 dist/mcp.js（dist/ 已 gitignore）
```

然后把上面配置里的 `command`/`args` 换成：

```yaml
    command: "node"
    args: ["/Users/lixiangting/Elio/ai-planner-lite/server/dist/mcp.js"]
```

这样启动几乎瞬时、运行时也不再需要 `tsx`。改了 `mcp.ts` 后记得重新 `npm run build:mcp`。

## 可用工具

| 工具 | 作用 |
|---|---|
| `list_tasks` | 查任务，`filter`: today / upcoming / overdue / inbox / all，可按 `project` 过滤 |
| `create_task` | 建任务（仅 `title` 必填；`due_date` 用 `YYYY-MM-DD`） |
| `update_task` | 改任务字段（截止/优先级/项目/标题…） |
| `complete_task` | 标记完成（重复任务自动推进周期） |
| `delete_task` | 删除任务（含子任务，不可恢复） |
| `set_sprint` | 加入/移出本周冲刺 |
| `list_projects` / `create_project` | 列/建项目 |
| `plan_tasks` | **AI 一次性规划**：倒一段想法进去，TaskFlow 用自己的上下文（任务快照/项目/agent_rules/日期）生成计划；见下节 |

相对日期（“明天”“本周五”）由 Hermes 侧的模型折算成绝对日期再调用；`project` 可传项目名（自动解析成 id）或 id。

## plan_tasks：让 TaskFlow 自己做规划

其余工具是「你（或 Hermes 的模型）想好了再落库」；`plan_tasks` 反过来——把**没想清楚的一段话**交给 TaskFlow 内置的规划核心（`POST /api/plan`），它基于应用自身状态（现有任务、项目、用户 agent_rules、今天的日期）产出结构化计划，调用方不必先 `list_tasks` 拉全量再自己推理。

### 前提：服务端配置 AI Key（headless 回退）

网页端的 AI 是 BYOK（Key 在浏览器 localStorage、逐请求携带），但 MCP 调用方没有浏览器。为此 `/api/plan` 提供**显式 opt-in** 的服务端回退：在 TaskFlow 的 `.env`（仓库根目录）里配置：

```bash
TASKFLOW_AI_KEY=sk-...        # 你的 DeepSeek（或其他 OpenAI 兼容服务）Key
# 可选：DEEPSEEK_BASE_URL / AI_PLANNER_MODEL 改服务商与默认模型
```

然后重启 TaskFlow（`npm start`）。没配 Key 时调用 `plan_tasks` 会得到清晰的中文报错，不会卡住。**Key 只进服务端进程环境，别提交进仓库。**

### 三段式用法

1. **倒想法**：`plan_tasks({ brain_dump: "下周要交开题报告，还想恢复健身" })`
   - 信息不足时返回编号的**澄清问题**（带选项）；把每题答案按顺序组成 `answers` 再调一次：
     `plan_tasks({ brain_dump: "…", answers: ["晚上", "每周三次"] })`
2. **审阅**：默认 `apply=false`，返回完整计划（逐条 op/标题/日期/优先级），**不落库**。
3. **落库**：确认后带 `apply: true` 用相同参数再调一次，逐条通过 REST 写入并返回成功/失败摘要。注意 apply 那次会**重新生成**计划再执行（一次性工具无状态，不缓存上一次的计划）。

`project` 参数（项目名或 id）决定两件事：规划时喂给模型的任务快照来自哪个项目、`create` 的新任务落到哪个项目（缺省收件箱）。

## 验证

1. **独立调试**（先 `npm start`）：
   ```bash
   npx @modelcontextprotocol/inspector \
     server/node_modules/.bin/tsx server/src/mcp.ts
   ```
   在 Inspector 里调 `create_task`，到 http://localhost:3001 看任务是否出现。
2. **经 Hermes**：在 Telegram 对 Hermes 说“加个任务：写周报，明天截止”，回网页端确认；再问“今天有哪些任务”，Hermes 会用 `list_tasks` 回读。
3. TaskFlow 没在跑时调工具，会返回“无法连接 TaskFlow（…）请确认已运行 npm start”的清晰提示，而非卡住。

## 之后想 24/7 可用？

同机 stdio 只在你电脑开机且 TaskFlow 在跑时有效。若要让 Telegram/Slack 随时能管任务，把 TaskFlow 和 Hermes 一起部署到常驻 VPS，并把本 MCP server 改成 HTTP 传输（挂进 Express `/mcp` + bearer token），Hermes 端用 `url:` + `headers:` 接入。
