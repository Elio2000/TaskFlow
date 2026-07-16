# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Install everything (root + server + client):**
```bash
npm run install:all
```

**Development (HMR):**
```bash
npm run dev          # concurrently: Vite client on :5173 + Express server on :3001 (client proxies /api to :3001)
```

**Production build + run:**
```bash
npm run build        # cd client && tsc -b && vite build  → client/dist
npm start            # cd server && tsx src/index.ts  → serves client/dist + API on http://localhost:3001
```

**Tests:**
```bash
npm test                          # node --test tests/*.test.mjs (pure-function unit tests; Node ≥22 native TS strip)
node --test tests/plan.test.mjs   # a single file
```

There is **no `.env` requirement** — the app is BYOK on the web (see AI section). The server start script uses `--env-file-if-exists`, so a clean clone runs with zero config. `TASKFLOW_AI_KEY` is only needed if headless callers (MCP `plan_tasks`) should be able to use AI.

## Architecture

Single-person personal planner. One runtime: a **Node/Express backend** that serves a **React/Vite frontend** and a local **SQLite** DB. (Historical note: an old Python `app.py` / Codex-SDK path described in earlier docs has been removed — it no longer exists. Ignore any reference to `app.py`, `codex_bridge.mjs`, `scripts/start.fish`, or port 5055.)

### Backend: `server/` (Node + Express + better-sqlite3)
- Entry: `server/src/index.ts` — Express on **port 3001**; attaches a single shared `db` to every request as `req.db`; mounts routes; serves `client/dist` as static in production.
- DB: `server/src/db.ts` — better-sqlite3 (synchronous) at **`data/todo.sqlite3`** (repo root), WAL mode, `foreign_keys = ON`. `initDB()` creates tables + runs idempotent migrations + data repairs on boot. `seed.ts` seeds an empty DB.
- Routes: `server/src/routes/` — `tasks`, `projects`, `labels`, `sections`, `settings`, `plan`, `cycles`.
- MCP server: `server/src/mcp.ts` (stdio) — 9 tools as thin wrappers over the REST API (`mcpLib.ts` holds its pure helpers). See `docs/hermes-mcp.md`.

### Frontend: `client/` (React + TypeScript + Vite)
- `client/src/App.tsx` — root; **state-based routing** (no router lib), theme, global task state (polled every 5s); ⌘/ opens the planner.
- `client/src/api.ts` — typed fetch wrappers for all backend REST calls (incl. `api.plan` + the `PlanResult` discriminated union).
- `client/src/views/` — `Views.tsx` (Today/Inbox/Upcoming/Calendar), `ProjectView`, `SprintView` (本周冲刺), `LabelView`.
- `client/src/ai/PlannerBox.tsx` — 一次性 AI 规划框 (modal, in-memory state only); renders `ProposalCard` (逐条/全部采纳) / `QuestionCard` (澄清反问 → answers 重发).
- `client/src/components/` — `TaskModal`, `QuickComposer`, `DateMenu`, `TaskRow`, `Sidebar`, `SettingsModal` (BYOK provider/model/key), etc.
- `client/src/utils/calendarGeom.ts` — pure date/drag-geometry functions (see testing convention below).

### AI: one-shot planning core (no chat)

The former chat panel + SSE stream was deliberately **collapsed into a one-shot planning tool**. There is no conversation state anywhere; one implementation serves two exits:

- **Core**: `server/src/plan.ts` — `planTasks(db, input)` assembles the layered system prompt (base role → optional `settings.agent_rules` override → project + task snapshot → date anchor → protocols → one-shot-mode note), makes a **non-streaming** chat completion (60s timeout; one retry with short backoff on network errors/5xx/429), parses + zod-validates the output, and on parse/validation failure does **one repair round** (feeds the raw output + error back, asks for just the fenced block). Returns a discriminated union `{ type: 'proposals'|'questions'|'error', …, meta: { model, latencyMs, retries, repaired } }`.
- **Pure layer**: `server/src/planLib.ts` — block extraction, JSON parsing, zod schemas (proposals/questions), repair-message construction, review formatting. Unit-tested in `tests/plan.test.mjs`; keep all new parsing/validation logic here.
- **Protocols**: `server/src/protocols.ts` — `PROPOSAL_PROTOCOL` / `QUESTION_PROTOCOL` prompt constants (the system contract; keep in sync with planLib schemas and PlannerBox rendering).
- **REST exit**: `POST /api/plan` (`server/src/routes/plan.ts`) — body `{ brain_dump, answers?, project_id?, apiKey?, baseUrl?, model? }`.
- **Web exit**: `PlannerBox.tsx` — BYOK fields from `localStorage` (`utils/byok.ts` + `providers.ts` presets) sent per request.
- **MCP exit**: `plan_tasks` in `mcp.ts` — calls `/api/plan`; returns questions (call again with `answers`), or the plan for review (`apply=false`, the confirmation gate), or applies ops one-by-one via REST (`apply=true`, note: regenerates the plan on that call — the tool is stateless).

**BYOK principle (deliberately revised)**: the web stays pure BYOK — the key arrives in the request body per request, lives only in browser `localStorage`, and there is no implicit server key for browsers. The revision: headless callers (MCP) can't do BYOK, so `/api/plan` falls back to the env var **`TASKFLOW_AI_KEY`** as an **explicit opt-in** (never committed, never read for any other route). Both paths stay provider-agnostic: any OpenAI-compatible `baseUrl` + `model` (defaults `DEEPSEEK_BASE_URL` / `AI_PLANNER_MODEL`).

## Key conventions

- **AI action protocols** (this app's own convention, unrelated to Claude Code's harness): the model ends its reply with a fenced block; visible text outside blocks is discarded.
  - ` ```proposals``` ` → task-mutation ops (`create`/`update`/`complete`/`delete`), zod-validated in `planLib.ts` → `ProposalCard` (逐条/全部采纳 via REST) or `plan_tasks` review/apply.
  - ` ```questions``` ` → option-based clarifying questions → `QuestionCard`; the picks become the `answers: string[]` of the next one-shot call. Never persisted.
  - To add a new protocol, mirror these three places: a `*_PROTOCOL` constant in `protocols.ts`, a schema + parse branch in `planLib.ts` (with tests), and a client card in `PlannerBox.tsx`.
- **Schema migrations**: `CREATE TABLE IF NOT EXISTS` won't alter existing tables. For new columns, follow the `in_sprint` pattern in `db.ts` — `PRAGMA table_info(tasks)`, then `ALTER TABLE … ADD COLUMN …` if absent.
- **AI rules** live in SQLite, not files: `settings.agent_rules` overrides the base system prompt (protocols + date anchor are always appended). There is no `agent.md` file.
- **本周冲刺 (sprint)**: the current week (Mon–Sun) is computed live on the client (`DateU.weekDates`) and never stored. Membership is the per-task boolean `tasks.in_sprint`; a flagged task drops out of the view automatically once its dates leave the week. `SprintView.tsx` + `taskInWeek` in `calendarGeom.ts`.
- **Pure functions + unit tests** for logic the headless browser preview can't exercise (drag gestures, date math, plan parsing): keep it in pure functions (e.g. `calendarGeom.ts`, `planLib.ts`, `mcpLib.ts`) and cover it in `tests/*.test.mjs`. The preview throttles `requestAnimationFrame` and can't synthesize pointer drags, so this is the reliable verification channel for that logic.
- **Legacy/unused**:
  - `conversations` / `messages` / `memories` / `agents_docs` tables are leftovers of the removed chat panel (collapsed into the one-shot planner). **Kept on purpose** (no destructive migration, old data preserved) but they have **no read/write paths** — their routes (`chat.ts`, `ai.ts`, `memories.ts`, `agentsDoc.ts`) were deleted. Don't build on them.
  - `cycles` + `cycle_tasks` tables and `/api/cycles` routes are leftovers from a removed "Cycles" view, superseded by `in_sprint` / `SprintView`. Safe to ignore; can be removed.

## 评测（eval/）

- **Layer 1 golden 回放（CI 门禁）**：`eval/fixtures/*.json` 固化「模型原始输出 → `parsePlanOutput` 预期结果」，`tests/planEval.test.mjs` 随 `npm test` 全量回放（确定性、零 key）。改 `planLib.ts` 的解析/校验行为时，行为变化必须先体现在 fixture 的 `expect` 里（golden 挂红是功能不是事故）；新增跑偏形态先加 fixture 再改代码。
- **Layer 2 live 基准（对照实验，非门禁）**：`npm run eval:live`（`eval/run-live.mjs`，纯 Node 零依赖）用 `eval/cases.jsonl` 标注集打真实 `/api/plan`，DeepSeek 与本地 Ollama 对照；provider 缺席自动 skip 并如实写入 `eval/REPORT.md`（入库），`eval/results/*.jsonl` 逐条结果不入库。
- 指标口径、expect DSL、加用例规范见 `eval/README.md`；fixtures/cases 必须手工撰写、有真实感，禁止占位符。新增第三种协议时，评测侧同步加对应 golden fixture 组。

## Environment variables

All optional — the app runs with none (web BYOK). Copy `.env.example` → `.env` only to override defaults.

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible gateway URL (the in-app provider picker overrides it per request) |
| `AI_PLANNER_MODEL` | `deepseek-chat` | Default model (the in-app model picker overrides it per request) |
| `TASKFLOW_AI_KEY` | — | **Headless opt-in** AI key for `/api/plan` when the request carries no `apiKey` (MCP `plan_tasks` etc.). Web stays pure BYOK. Never commit it. |
