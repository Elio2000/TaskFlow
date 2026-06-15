/* ============================================================
   BYOK (Bring Your Own Key) — per-browser AI key config.

   This app is BYOK-only: every user must supply their own DeepSeek API key.
   The key lives ONLY in localStorage (never the shared server DB or git), so
   when the app is shared each user's key stays on their own machine. AI requests
   carry the key in the POST body; the server has no fallback key.
   ============================================================ */

const K_KEY = 'byok_key'
const K_MODEL = 'byok_model'

export interface ByokConfig { key: string; model: string }

export function getByokConfig(): ByokConfig {
  return { key: localStorage.getItem(K_KEY) || '', model: localStorage.getItem(K_MODEL) || '' }
}

export function setByokConfig(c: ByokConfig): void {
  localStorage.setItem(K_KEY, c.key.trim())
  localStorage.setItem(K_MODEL, c.model.trim())
}

/** Fields to merge into an AI request body. */
export function byokBody(): { apiKey?: string; model?: string } {
  const c = getByokConfig()
  if (c.key) return { apiKey: c.key, ...(c.model ? { model: c.model } : {}) }
  return {}
}

/** Returns a user-facing error if no key is configured, else null. */
export function byokError(): string | null {
  if (!getByokConfig().key) return '请先在 AI 设置中填写你的 DeepSeek API Key（本应用仅支持自带 Key）。'
  return null
}
