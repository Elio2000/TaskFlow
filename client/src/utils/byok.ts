/* ============================================================
   BYOK (Bring Your Own Key) — per-browser AI provider config.

   This app is BYOK-only: every user supplies their own API key. The key lives ONLY
   in localStorage (never the shared server DB or git), so when the app is shared each
   user's key stays on their own machine. AI requests carry the key + baseUrl + model
   in the POST body; the server has no fallback key and is provider-agnostic.

   Multi-provider: the provider preset list lives in ../providers (client-side only).
   We just resolve { providerId } → { baseUrl } and send baseUrl/model/key per request.
   ============================================================ */
import { DEFAULT_PROVIDER, getProvider } from '../providers'

const K_KEY = 'byok_key'
const K_MODEL = 'byok_model'
const K_PROVIDER = 'byok_provider'
const K_BASE_URL = 'byok_base_url'   // only used when the provider is "custom"

export interface ByokConfig { providerId: string; key: string; model: string; baseUrl: string }

export function getByokConfig(): ByokConfig {
  // Migration: pre-multi-provider installs only had byok_key/byok_model → default to DeepSeek,
  // so an existing user's saved key/model keeps working untouched.
  return {
    providerId: localStorage.getItem(K_PROVIDER) || DEFAULT_PROVIDER,
    key: localStorage.getItem(K_KEY) || '',
    model: localStorage.getItem(K_MODEL) || '',
    baseUrl: localStorage.getItem(K_BASE_URL) || '',
  }
}

export function setByokConfig(c: ByokConfig): void {
  localStorage.setItem(K_PROVIDER, c.providerId)
  localStorage.setItem(K_KEY, c.key.trim())
  localStorage.setItem(K_MODEL, c.model.trim())
  localStorage.setItem(K_BASE_URL, c.baseUrl.trim())
}

/** The effective base URL: custom uses the user's input, otherwise the preset's. */
export function effectiveBaseUrl(c: ByokConfig): string {
  const p = getProvider(c.providerId)
  return (p.custom ? c.baseUrl : p.baseUrl).trim().replace(/\/+$/, '')
}

/** Fields to merge into an AI request body. */
export function byokBody(): { apiKey?: string; model?: string; baseUrl?: string } {
  const c = getByokConfig()
  const p = getProvider(c.providerId)
  const baseUrl = effectiveBaseUrl(c)
  const out: { apiKey?: string; model?: string; baseUrl?: string } = {}
  // Local servers (Ollama) need no key, but the server still requires a non-empty apiKey,
  // so send a harmless placeholder the local endpoint ignores.
  if (c.key) out.apiKey = c.key
  else if (p.keyless) out.apiKey = 'local'
  if (c.model) out.model = c.model
  if (baseUrl) out.baseUrl = baseUrl
  return out
}

/** Returns a user-facing error if the config is incomplete, else null. */
export function byokError(): string | null {
  const c = getByokConfig()
  const p = getProvider(c.providerId)
  if (!p.keyless && !c.key) return `请先在 AI 设置中填写 ${p.label} 的 API Key（本应用仅支持自带 Key）。`
  if (p.custom && !effectiveBaseUrl(c)) return '请在 AI 设置中填写自定义服务的 Base URL（需 OpenAI 兼容）。'
  // Only DeepSeek has a safe server-side default model ('deepseek-chat'); for any other
  // provider an empty model would send that DeepSeek id to the wrong endpoint, so require one.
  if (c.providerId !== DEFAULT_PROVIDER && !c.model.trim()) return `请在 AI 设置中填写 ${p.label} 的模型 id。`
  return null
}
