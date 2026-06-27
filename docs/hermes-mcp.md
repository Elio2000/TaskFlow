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
      include: [list_tasks, create_task, update_task, complete_task, list_projects, create_project]
```

- 路径换成你自己的仓库绝对路径。
- **直接指向 `tsx` 二进制**，不要用 `npm run`——`npm` 会往 stdout 打印日志，破坏 stdio MCP 协议。
- `tools.include` 只放了安全子集；想让 Hermes 也能删任务/打冲刺标记，加上 `delete_task` / `set_sprint`。
- 改完执行 `hermes mcp` 或运行时 `/reload-mcp` 生效。

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

相对日期（“明天”“本周五”）由 Hermes 侧的模型折算成绝对日期再调用；`project` 可传项目名（自动解析成 id）或 id。

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
