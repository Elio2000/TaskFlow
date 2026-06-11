# AI Planner Lite

个人使用的轻量 AI 任务拆解老师。

特点：

- 不依赖 Plane
- 不需要登录、团队、Workspace
- Web 访问
- Plane 风格左侧导航和高密度工作台
- Projects、Work Items、Kanban、Today 课表
- 任务只需标题即可创建，其他字段可后补
- 对话式 AI Teacher
- SQLite 本地存储
- Python 运行时零第三方依赖
- Codex SDK thread resume
- Markdown 长期记忆
- 内置本地适配器按 CC Switch 的架构将 Codex Responses 转成 DeepSeek Chat Completions
- 不修改现有 CC Switch、`~/.codex` 或 Codex App 登录

## 首次配置

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm install
```

每次 AI 请求期间，应用会在随机本地端口启动一个临时 Responses 适配器，请求结束后立即关闭。
真实 DeepSeek key 只由这个本地进程读取，不会传给 Codex CLI 子进程。

AI Teacher 的网页聊天默认使用 DeepSeek Chat Completions SSE 直接流式输出。
`AI_PLANNER_THINKING=disabled` 会更像普通聊天，首字更快；改成 `enabled` 时会显示推理状态心跳。

聊天等待控制：

- `AI_PLANNER_FIRST_REPLY_TIMEOUT_SECONDS=25`：超过这个时间还没有任何可见回复，会自动停止。
- `AI_PLANNER_IDLE_TIMEOUT_SECONDS=60`：超过这个时间没有收到任何模型信号，会自动停止。
- `AI_PLANNER_TIMEOUT_SECONDS=180`：单次请求总时限。

如果你希望它像普通聊天机器人一样快，保持 `AI_PLANNER_THINKING=disabled`。如果打开 thinking，前端仍会按“可见回复超时”停止，避免一直卡在 thinking。

## 启动

Fish：

```fish
fish scripts/start.fish
```

浏览器打开：

```text
http://localhost:5055
```

同一局域网内手机访问：

```text
http://你的电脑IP:5055
```

查看本机 IP：

```bash
ipconfig getifaddr en0
```

## 数据

SQLite 数据：

```text
data/planner.sqlite3
```

AI Planner 的全部私有数据统一放在 `data/`：

```text
data/
├── planner.sqlite3
├── codex-home/
│   └── sessions/
└── memory/
    ├── profile.md
    ├── projects.md
    └── daily/YYYY-MM-DD.md
```

`data/codex-home` 是独立 `CODEX_HOME`，不会读取或修改你当前 Codex App 使用的
`~/.codex/config.toml`、`~/.codex/auth.json` 和 `~/.codex/sessions`。

## 配置 AI 老师规则

编辑：

```text
agent.md
```

也可以在 `Settings -> AI Planner` 中直接修改。

## 页面

- `Work Items`：全部任务列表和快速创建，支持搜索、状态/标签/优先级筛选和基础排序
- `Board`：按自定义 State 生成看板列，支持拖拽切换状态
- `Today`：按日期查看课表
- `AI Teacher`：连续对话、日报和任务拆解；支持 Markdown、`/compact`、`@` 引用任务
- `Projects`：长期项目及完成进度
- `Settings`：模型状态、`agent.md`、自定义 State、Labels 和 Markdown 长期记忆

## AI Teacher 输入

- Markdown 会被渲染成正文样式，不再直接显示 `**bold**`。
- 输入 `/` 会出现斜杠命令；当前支持 `/compact`，用于把当前聊天压缩进长期记忆并清空原始对话。
- 输入 `@` 会出现未完成任务列表，选中后插入 `@#任务ID 标题`，AI 可以结合这个任务继续讨论。

## Plane 功能迁移清单

Plane 的任务管理功能盘点和迁移批次见：

```text
docs/plane-task-feature-inventory.md
```

## 设计取舍

这个项目刻意不做：

- 登录
- 多用户
- 团队协作
- 权限
- Plane 级复杂跨视图拖拽和自动化工作流
- Docker
- Redis/Postgres/Celery

它只解决个人跨设备访问、项目任务管理、连续对话、长期记忆和 AI 拆任务。
