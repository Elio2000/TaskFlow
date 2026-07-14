# TaskFlow

> 本地优先、单人使用的 AI 任务规划工具。无需登录、无需云端，数据全在你自己的机器上。

TaskFlow 把「待办清单」和「会规划的 AI 助手」放在一起：你用自然语言说出目标，AI 助手帮你拆成可执行的任务、安排时间和截止日期；关键信息不够时它会**先反问澄清**，而不是替你瞎猜。所有数据存在本地 SQLite，AI 用你自己的 DeepSeek Key（BYOK），不经过任何第三方服务器。

<!-- 截图占位：建议在此放一张主界面截图或操作 GIF（如 docs/screenshot.png），首屏的图能极大提升项目可读性。
![TaskFlow](docs/screenshot.png) -->

## 特性

- **多视图工作台** —— 今天 / 收件箱 / 即将到来 / 日历（月·周·日）/ 项目 / 标签 / 本周冲刺
- **AI 助手（专注 todo 规划，BYOK）** —— 自然语言拆任务、排时间；信息模糊时先「智能反问」带选项澄清，再给出可一键采纳的任务建议
- **日历拖拽** —— 周/日视图拖动改时间、跨天拖动改日期；支持有开始/截止时间的多日任务（区间内每天一个实例）
- **本周冲刺** —— 把本周重要的大事件挑进一个聚焦视图，带完成进度条
- **键盘优先** —— ⌘K 搜索、⌘/ 唤起 AI、`T`/`I`/`U`/`C` 快速切换视图
- **本地优先** —— 数据存本地 SQLite，无账号、无云端、无遥测
- **深浅色主题**

## 技术栈

- **前端**：React + TypeScript + Vite
- **后端**：Node.js + Express + better-sqlite3（本地 SQLite）
- **AI**：DeepSeek Chat Completions，SSE 流式输出；**BYOK**——用你自己的 Key，存在浏览器本地

## 快速开始

需要 Node.js ≥ 22。

```bash
git clone https://github.com/Elio2000/TaskFlow.git
cd TaskFlow

npm run install:all   # 安装 根 / server / client 三处依赖
npm run build         # 构建前端
npm start             # 启动服务
```

打开 **http://localhost:3001**，在左下角「AI 设置」里填入你的 DeepSeek API Key（[在此获取](https://platform.deepseek.com/)）。Key 只存在你的浏览器本地，不会上传服务器、也不会写进仓库。

> 不需要创建 `.env`——TaskFlow 默认 BYOK，开箱即用、零配置。

### 开发模式（热更新）

```bash
npm run dev   # 同时启动 Vite(5173) 和后端(3001)，前端通过代理访问 API
```

### 运行测试

```bash
npm test      # 纯函数单元测试（日期/拖拽几何等）
```

## 数据与隐私

- 所有任务、项目数据存在本地 SQLite：`data/todo.sqlite3`
- DeepSeek Key 存在浏览器 `localStorage`，每次请求随消息发给本地后端转发给 DeepSeek，**不落库、不上传、不进仓库**
- 没有账号、没有团队、没有云端同步、没有遥测

## 集成（Hermes / MCP）

TaskFlow 自带一个 **MCP server**（`server/src/mcp.ts`），把任务操作暴露成 MCP 工具。接入 [Hermes Agent](https://hermes-agent.nousresearch.com) 等 MCP 客户端后，就能在 Telegram / Slack 里用自然语言查/建/改任务，数据落到同一个本地 SQLite、网页端实时可见。设置见 [docs/hermes-mcp.md](docs/hermes-mcp.md)。

## 设计取舍

TaskFlow 刻意**不做**：登录、多用户、团队协作、权限、云端同步。

它只解决一件事：**一个人，把自己的事规划好。** 所以它快、简单、数据完全归你自己。

## AI 协作开发（AI-assisted development）

TaskFlow 同时是一次「规格驱动 + AI 协作」的开发实践，仓库如实保留了全过程：

- **人负责**：产品定义与交互设计、架构与技术选型、任务规格（[TODO.md](TODO.md)，3000+ 行，每项任务写明问题定位、涉及文件、修改方案与验收标准），以及每一项改动的人工验收与调试定夺；
- **AI 负责**：在上述规格约束下，由 Claude / Kimi 等模型完成大部分编码，以 feature branch + PR 的节奏合入，commit 历史未做美化；
- **质量护栏**：容易出错的核心逻辑（日历几何、MCP 过滤、中文 NLP 解析）抽成纯函数并覆盖 47 个单元测试，人工端到端验收后才合并。

把这段写出来，是因为「把 AI 编码组织成可验收、可维护的交付」正是这个项目想展示的工程能力之一。

## 反馈

这是个人项目，欢迎 [提 Issue](https://github.com/Elio2000/TaskFlow/issues) 提需求或报 bug——你的真实使用反馈会直接影响后续方向。

## License

ISC
