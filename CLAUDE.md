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
node --test tests/calendar.test.mjs   # a single file
```

There is **no `.env` requirement** — the app is BYOK (see AI section). The server start script uses `--env-file-if-exists`, so a clean clone runs with zero config.

## Architecture

Single-person personal planner. One runtime: a **Node/Express backend** that serves a **React/Vite frontend** and a local **SQLite** DB. (Historical note: an old Python `app.py` / Codex-SDK path described in earlier docs has been removed — it no longer exists. Ignore any reference to `app.py`, `codex_bridge.mjs`, `scripts/start.fish`, or port 5055.)

### Backend: `server/` (Node + Express + better-sqlite3)
- Entry: `server/src/index.ts` — Express on **port 3001**; attaches a single shared `db` to every request as `req.db`; mounts routes; serves `client/dist` as static in production.
- DB: `server/src/db.ts` — better-sqlite3 (synchronous) at **`data/todo.sqlite3`** (repo root), WAL mode, `foreign_keys = ON`. `initDB()` creates tables + runs idempotent migrations + data repairs on boot. `seed.ts` seeds an empty DB.
- Routes: `server/src/routes/` — `tasks`, `projects`, `labels`, `sections`, `chat`, `ai`, `memories`, `agentsDoc`, `settings`, `cycles`.

### Frontend: `client/` (React + TypeScript + Vite)
- `client/src/App.tsx` — root; **state-based routing** (no router lib), theme, global task state (polled every 5s).
- `client/src/api.ts` — typed fetch wrappers for all backend REST calls.
- `client/src/views/` — `Views.tsx` (Today/Inbox/Upcoming/Calendar), `ProjectView`, `SprintView` (本周冲刺), `LabelView`.
- `client/src/ai/AIPanel.tsx` — AI 助手 chat panel (float/sidebar/bottom layouts); renders `ProposalCard` / `QuestionCard`.
- `client/src/components/` — `TaskModal`, `QuickComposer`, `DateMenu`, `TaskRow`, `Sidebar`, etc.
- `client/src/utils/calendarGeom.ts` — pure date/drag-geometry functions (see testing convention below).

### AI: `server/src/routes/ai.ts`
- `POST /api/chat/stream` — DeepSeek Chat Completions via `fetch`, streamed back over SSE.
- **BYOK-only**: the DeepSeek key arrives in the request body (`apiKey`) per request; there is **no server-side fallback key**. Never commit a key. The client stores it in `localStorage`.
- System prompt is assembled in `ai.ts`: base role string → optional `settings.agent_rules` override → per-project context (project, `memories`, `agents_docs`, task list) → current date → `PROPOSAL_PROTOCOL` → `QUESTION_PROTOCOL`.

## Key conventions

- **AI action protocols** (this app's own convention, unrelated to Claude Code's harness): the model emits fenced blocks after its visible reply. The server strips them from the streamed text, parses them, and sends them in the SSE `done` event; the client renders cards.
  - ` ```proposals``` ` → task-mutation suggestions, **persisted** in `messages.proposals` → `ProposalCard` ("应用全部").
  - ` ```questions``` ` → option-based clarifying questions, **transient** (not stored) → `QuestionCard`; the user's picks compose into a follow-up message that then yields proposals.
  - To add a new protocol, mirror these: a `*_PROTOCOL` prompt constant, a server-side parse + `done`-event field, and a client card.
- **Schema migrations**: `CREATE TABLE IF NOT EXISTS` won't alter existing tables. For new columns, follow the `in_sprint` pattern in `db.ts` — `PRAGMA table_info(tasks)`, then `ALTER TABLE … ADD COLUMN …` if absent.
- **Memory & AI rules** live in SQLite, not files: `memories` (per-project facts), `agents_docs` (a per-project AGENTS.md), and `settings.agent_rules` (overrides the base system prompt). There is no `agent.md` file.
- **本周冲刺 (sprint)**: the current week (Mon–Sun) is computed live on the client (`DateU.weekDates`) and never stored. Membership is the per-task boolean `tasks.in_sprint`; a flagged task drops out of the view automatically once its dates leave the week. `SprintView.tsx` + `taskInWeek` in `calendarGeom.ts`.
- **Pure functions + unit tests** for logic the headless browser preview can't exercise (drag gestures, date math): keep it in pure functions (e.g. `calendarGeom.ts`) and cover it in `tests/*.test.mjs`. The preview throttles `requestAnimationFrame` and can't synthesize pointer drags, so this is the reliable verification channel for that logic.
- **Legacy/unused**: the `cycles` + `cycle_tasks` tables and `/api/cycles` routes are leftovers from a removed "Cycles" view, superseded by `in_sprint` / `SprintView`. Safe to ignore; can be removed.

## Environment variables

All optional — the app runs with none (BYOK). Copy `.env.example` → `.env` only to override defaults.

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek-compatible gateway URL |
| `AI_PLANNER_MODEL` | `deepseek-chat` | Default model (the in-app model picker overrides it per request) |
| `AI_PLANNER_THINKING` | `disabled` | `enabled` surfaces a reasoning heartbeat |
