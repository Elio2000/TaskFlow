#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

if [[ ! -d node_modules/@openai/codex-sdk ]]; then
  echo "Codex SDK is missing. Run: npm install" >&2
  exit 1
fi

exec python3 app.py
