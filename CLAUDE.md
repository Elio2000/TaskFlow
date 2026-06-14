# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Start the app (primary):**
```fish
fish scripts/start.fish
```
This starts `app.py` (the Python web server) on port 5055. The script checks for `.env` and the Codex SDK before launching.

**Run all tests:**
```bash
npm test
# Runs: node --test tests/*.test.mjs  (nlp + labels pure-function unit tests, via Node 25 native TS type-stripping)
```

**Run a single test file:**
```bash
node --test tests/nlp.test.mjs
```

**Build the frontend:**
```bash
npm run build   # runs: cd client && npm run build
```

**First-time setup:**
```bash
cp .env.example .env   # then fill in DEEPSEEK_API_KEY
npm install
```

**Check bridge syntax:**
```bash
npm run check:bridge
```

## Architecture

This is a single-person personal planner. It has **two distinct runtime modes** — understand which is active before editing:

### Mode 1: `app.py` (primary, always active)
`app.py` is a zero-dependency Python `ThreadingHTTPServer` that:
- Serves the frontend from `static/` (the Vite build output copied there, or `client/dist/`)
- Exposes a REST API (`/api/...`) backed by SQLite at `data/planner.sqlite3`
- Streams AI Teacher responses via SSE at `POST /api/ai/chat/stream`
- The AI chat uses **DeepSeek Chat Completions** directly via `curl` subprocess — no Python HTTP library

The Python server is the **only runtime required** for normal use. There is no separate Node server needed.

### Mode 2: Codex SDK path (optional, for structured task creation)
When `AI_PROVIDER=codex_sdk` is set and triggered, `app.py` spawns `codex_bridge.mjs` (Node.js) as a subprocess via stdin/stdout JSON protocol. `codex_bridge.mjs` starts a temporary local HTTP proxy (`deepseek_responses_proxy.mjs`) that translates OpenAI Responses API format → DeepSeek Chat Completions, allowing the Codex SDK to talk to DeepSeek without modifying `~/.codex` or the Codex App.

### Frontend: `client/` (React + TypeScript + Vite)
- `client/src/App.tsx` — root component; manages routing, theme, global task state (polled every 5s)
- `client/src/api.ts` — typed fetch wrappers for all backend REST calls
- `client/src/views/` — page views: Today, Inbox, Upcoming, Calendar, Board, List
- `client/src/ai/AIPanel.tsx` — AI Teacher chat panel (float/sidebar/bottom layouts)
- `client/src/components/TaskModal.tsx` — full task detail/edit modal

The built frontend is served from `static/index.html` by `app.py`. During development, run `npm run dev:client` for Vite HMR.

### There is also an unrelated `server/` directory
`server/` is a separate older TypeScript/Express server (`server/src/index.ts`) with its own SQLite DB (`data/todo.sqlite3`). It is **not used** by the main `app.py` flow — do not confuse its routes or DB with `app.py`'s.

## Key design decisions

- **All DB access in `app.py` is serialized** through `_db_lock` (a threading.Lock). The `_LockedConnection` wrapper releases the lock on `.close()`. Never hold the connection past a `with` block.
- **Soft deletes**: tasks use `deleted_at` (soft delete) and `archived_at` (archive) — never hard-deleted via the API. Most queries filter `WHERE deleted_at = ''`.
- **State vs status**: `tasks.state_id` references a user-customizable `states` table. `tasks.status` (`todo`/`doing`/`done`) is a denormalized computed value derived from `states.group_key`. Both are kept in sync on every write.
- **AI Teacher action protocol**: The streaming chat endpoint uses a hidden delimiter `<ai_planner_actions>…</ai_planner_actions>` appended after the visible reply. The server strips the action block before sending SSE chunks to the client; on stream close it parses and applies task/memory mutations.
- **Memory is Markdown files** in `data/memory/`: `profile.md`, `projects.md`, `daily/YYYY-MM-DD.md`. The AI prompt injects these as context. `/compact` summarizes the chat into today's daily file and clears the DB messages table.
- **AI rules** are read live from `agent.md` on every request — edit that file to change the AI Teacher's behavior without restarting.

## Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Required. Read only by the local adapter subprocess. |
| `AI_PLANNER_MODEL` | `deepseek-v4-pro` | DeepSeek model name |
| `AI_PLANNER_THINKING` | `disabled` | `enabled` shows reasoning heartbeat; `disabled` is faster |
| `AI_PLANNER_FIRST_REPLY_TIMEOUT_SECONDS` | `25` | Abort if no visible reply within N seconds |
| `AI_PLANNER_IDLE_TIMEOUT_SECONDS` | `60` | Abort if no model signal within N seconds |
| `AI_PLANNER_TIMEOUT_SECONDS` | `180` | Total request time limit |
| `PORT` | `5055` | Web server port |
