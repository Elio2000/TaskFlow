/* ============================================================
   BYOK provider presets.

   Every entry below speaks the OpenAI-compatible `/chat/completions` shape, so the
   single server adapter (server/src/routes/ai.ts) serves them all — we only vary
   `baseUrl` + `model` per request. "custom" lets the user point at any other
   OpenAI-compatible endpoint (self-hosted vLLM / LM Studio / MiniMax / …).

   NOT covered: native Anthropic Claude / Google Gemini (different API shape) — those
   would need a separate adapter. You can still reach Claude via OpenRouter (it proxies
   to the OpenAI shape).

   `models` are editable suggestions for the dropdown; the user can type any model id.
   ============================================================ */
export interface Provider {
  id: string
  label: string
  baseUrl: string       // OpenAI-compatible base; `/chat/completions` is appended by the server
  models: string[]      // suggested model ids (editable)
  keyless?: boolean      // local servers (Ollama) need no API key
  custom?: boolean       // user supplies the baseUrl
  keyHint?: string       // where to get a key
}

export const PROVIDERS: Provider[] = [
  { id: 'deepseek',    label: 'DeepSeek',            baseUrl: 'https://api.deepseek.com',                          models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'platform.deepseek.com' },
  { id: 'moonshot',    label: 'Kimi (Moonshot)',     baseUrl: 'https://api.moonshot.cn/v1',                        models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], keyHint: 'platform.moonshot.cn' },
  { id: 'qwen',        label: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], keyHint: 'bailian.console.aliyun.com' },
  { id: 'siliconflow', label: 'SiliconFlow',         baseUrl: 'https://api.siliconflow.cn/v1',                     models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], keyHint: 'siliconflow.cn' },
  { id: 'openrouter',  label: 'OpenRouter',          baseUrl: 'https://openrouter.ai/api/v1',                      models: ['deepseek/deepseek-chat', 'qwen/qwen-2.5-72b-instruct'], keyHint: 'openrouter.ai/keys' },
  { id: 'openai',      label: 'OpenAI',              baseUrl: 'https://api.openai.com/v1',                         models: ['gpt-4o-mini', 'gpt-4o'], keyHint: 'platform.openai.com' },
  { id: 'ollama',      label: '本地 Ollama',          baseUrl: 'http://localhost:11434/v1',                         models: ['qwen2.5', 'llama3.1'], keyless: true },
  { id: 'custom',      label: '自定义 (OpenAI 兼容)',  baseUrl: '',                                                  models: [], custom: true },
]

export const DEFAULT_PROVIDER = 'deepseek'

export function getProvider(id: string): Provider {
  return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]
}
