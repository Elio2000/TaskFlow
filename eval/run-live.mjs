#!/usr/bin/env node
/* Layer 2 live 基准 —— 用 eval/cases.jsonl 的标注请求打真实 POST /api/plan，
   对照强模型（DeepSeek）与本地弱模型（Ollama 小模型）在同一协议下的表现：
   澄清触发准确率 / 一次解析成功率 / 修复救回率 / 错误率 / 延迟分位数。

   纯 Node 无第三方依赖。Provider 缺 key / 服务不在时优雅 skip（如实写进报告），
   全部 provider 均不可用时 exit 0——live 基准是对照实验，不是 CI 门禁。
   运行：npm run eval:live   方法论与指标口径：eval/README.md */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const EVAL_DIR = dirname(fileURLToPath(import.meta.url))
const CASES_PATH = join(EVAL_DIR, 'cases.jsonl')
const RESULTS_DIR = join(EVAL_DIR, 'results')
const REPORT_PATH = join(EVAL_DIR, 'REPORT.md')

const TASKFLOW_URL = (process.env.TASKFLOW_URL || 'http://localhost:3001').replace(/\/+$/, '')
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
// 服务端单次规划最长 ~4 轮 60s 请求（首轮+网络重试+修复轮+其重试），客户端给足余量
const CASE_TIMEOUT_MS = 300_000

/* ============ 小工具 ============ */

const fmtRate = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}% (${n}/${total})` : '—')

/** 最近秩法分位数（P50/P95 用），空数组返回 null。 */
function percentile(sorted, q) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx]
}

async function fetchJson(url, options = {}, timeoutMs = 5_000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  const body = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, body }
}

/* ============ 前置检查 + 标注集加载 ============ */

async function assertTaskflowUp() {
  try {
    const r = await fetchJson(`${TASKFLOW_URL}/api/projects`)
    if (!r.ok) throw new Error(`GET /api/projects 返回 ${r.status}`)
  } catch (e) {
    console.error(`[eval:live] TaskFlow 不在 ${TASKFLOW_URL}（${e?.message || e}）。`)
    console.error('[eval:live] 请先启动服务再重跑：npm run dev（开发）或 npm run build && npm start（生产）。')
    process.exit(1)
  }
}

function loadCases() {
  const lines = readFileSync(CASES_PATH, 'utf8').split('\n').filter(l => l.trim())
  const cases = lines.map((l, i) => {
    const c = JSON.parse(l)
    if (!c.id || !c.brain_dump || !['proposals', 'questions'].includes(c.expect_type)) {
      throw new Error(`cases.jsonl 第 ${i + 1} 行缺 id/brain_dump 或 expect_type 非法`)
    }
    return c
  })
  const ids = new Set(cases.map(c => c.id))
  if (ids.size !== cases.length) throw new Error('cases.jsonl 存在重复 id')
  return cases
}

/* ============ Provider 探测 ============ */

/** @returns {{ available: {name,baseUrl,model,apiKey}[], skipped: {name,reason}[] }} */
async function detectProviders() {
  const available = []
  const skipped = []

  // DeepSeek（或任意 OpenAI 兼容云端服务，走同一对 env）
  const dsKey = (process.env.TASKFLOW_AI_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
  if (dsKey) {
    available.push({
      name: 'deepseek',
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: process.env.AI_PLANNER_MODEL || 'deepseek-chat',
      apiKey: dsKey,
    })
  } else {
    skipped.push({ name: 'deepseek', reason: '未设置 TASKFLOW_AI_KEY / DEEPSEEK_API_KEY' })
  }

  // Ollama：探测本地服务并挑一个小模型（qwen* / llama* 优先）
  try {
    const r = await fetchJson(`${OLLAMA_URL}/api/tags`)
    const models = (r.body?.models || []).map(m => m.name).filter(Boolean)
    if (!r.ok) {
      skipped.push({ name: 'ollama', reason: `GET /api/tags 返回 ${r.status}` })
    } else if (!models.length) {
      skipped.push({ name: 'ollama', reason: 'Ollama 在跑但没有已拉取的模型（先 ollama pull qwen2.5:3b）' })
    } else {
      const pick = models.find(m => /qwen/i.test(m)) || models.find(m => /llama/i.test(m)) || models[0]
      available.push({
        name: 'ollama',
        baseUrl: `${OLLAMA_URL}/v1`, // OpenAI 兼容端点
        model: pick,
        apiKey: 'ollama', // Ollama 不校验 key，但 /api/plan 要求非空
      })
    }
  } catch {
    skipped.push({ name: 'ollama', reason: `${OLLAMA_URL} 不可达（未安装或未启动，安装见 eval/README.md）` })
  }

  return { available, skipped }
}

/* ============ 逐 case 执行 ============ */

async function runCase(provider, c) {
  const t0 = Date.now()
  let response
  try {
    const r = await fetchJson(
      `${TASKFLOW_URL}/api/plan`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brain_dump: c.brain_dump,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
        }),
      },
      CASE_TIMEOUT_MS,
    )
    if (!r.ok) {
      // /api/plan 对模型侧失败也返回 200+error 型结果；非 200 说明入参/服务本身有问题，如实记为 error
      response = { type: 'error', error: `HTTP ${r.status}：${r.body?.error || JSON.stringify(r.body)}` }
    } else {
      response = r.body
    }
  } catch (e) {
    response = { type: 'error', error: `请求失败：${e?.message || e}` }
  }

  const clientLatencyMs = Date.now() - t0
  const meta = response?.meta || {}
  return {
    provider: provider.name,
    model: provider.model,
    case_id: c.id,
    expect_type: c.expect_type,
    type: response?.type ?? 'error',
    type_match: response?.type === c.expect_type,
    repaired: Boolean(meta.repaired),
    retries: meta.retries ?? 0,
    latencyMs: meta.latencyMs ?? clientLatencyMs, // 优先服务端计时；传输层失败时退回客户端计时
    clientLatencyMs,
    n_items: response?.proposals?.length ?? response?.questions?.length ?? null,
    error: response?.type === 'error' ? response.error : undefined,
    response,
  }
}

/* ============ 指标汇总（口径见 eval/README.md，分母均为该 provider 的全部 case） ============ */

function summarize(provider, rows) {
  const n = rows.length
  const latencies = rows.map(r => r.latencyMs).sort((a, b) => a - b)
  return {
    provider: provider.name,
    model: provider.model,
    cases: n,
    type_match: rows.filter(r => r.type_match).length,
    parse_ok_first_try: rows.filter(r => r.type !== 'error' && !r.repaired).length,
    repaired_rescue: rows.filter(r => r.repaired && r.type !== 'error').length,
    errors: rows.filter(r => r.type === 'error').length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
  }
}

/* ============ 报告 ============ */

function renderReport({ generatedAt, caseCount, summaries, skipped, resultsFile }) {
  const lines = []
  lines.push('# TaskFlow plan_tasks — live 基准报告')
  lines.push('')
  lines.push('> 本文件由 `npm run eval:live` 自动生成/刷新，请勿手改。指标口径见 [eval/README.md](README.md)。')
  lines.push('')
  lines.push(`- 生成时间：${generatedAt}`)
  lines.push(`- 标注集：\`eval/cases.jsonl\`（${caseCount} 条；约半数信息充分应出 proposals，半数刻意模糊应出 questions）`)
  lines.push(`- 逐条原始结果：${resultsFile ? `\`eval/results/${resultsFile}\`（不入库）` : '本次无（所有 provider 均被跳过）'}`)
  lines.push('')
  lines.push('| Provider | Model | 状态 | cases | type_match_rate | parse_ok_first_try | repaired_rescue_rate | error_rate | p50 延迟 | p95 延迟 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const s of summaries) {
    lines.push(
      `| ${s.provider} | \`${s.model}\` | 运行 | ${s.cases} | ${fmtRate(s.type_match, s.cases)} | ${fmtRate(s.parse_ok_first_try, s.cases)} | ${fmtRate(s.repaired_rescue, s.cases)} | ${fmtRate(s.errors, s.cases)} | ${s.p50} ms | ${s.p95} ms |`,
    )
  }
  for (const s of skipped) {
    lines.push(`| ${s.name} | — | skip：${s.reason} | — | — | — | — | — | — | — |`)
  }
  lines.push('')
  if (!summaries.length) {
    lines.push('本次运行**没有产生任何指标数据**——所有 provider 均不可用（原因见上表）。')
    lines.push('配好 DeepSeek Key 或启动本地 Ollama 后重跑 `npm run eval:live`，本报告会被真实数据覆盖；配置方法见 [eval/README.md](README.md)。')
    lines.push('')
  }
  return lines.join('\n')
}

/* ============ 主流程 ============ */

async function main() {
  await assertTaskflowUp()
  const cases = loadCases()
  const { available, skipped } = await detectProviders()

  for (const s of skipped) console.log(`[eval:live] skip ${s.name}：${s.reason}`)

  const allRows = []
  const summaries = []
  for (const provider of available) {
    console.log(`\n[eval:live] provider=${provider.name} model=${provider.model}（${cases.length} 条，串行）`)
    const rows = []
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      const row = await runCase(provider, c)
      rows.push(row)
      allRows.push(row)
      const verdict = row.type === 'error' ? `error（${String(row.error).slice(0, 60)}）` : row.type
      const mark = row.type_match ? 'ok ' : 'MISS'
      console.log(
        `  [${String(i + 1).padStart(2, '0')}/${cases.length}] ${mark} ${c.id} → ${verdict}（期望 ${c.expect_type}）${row.repaired ? ' [repaired]' : ''} ${row.latencyMs}ms`,
      )
    }
    summaries.push(summarize(provider, rows))
  }

  // 逐条原始结果（仅当真的跑了至少一个 provider）
  let resultsFile = null
  if (allRows.length) {
    mkdirSync(RESULTS_DIR, { recursive: true })
    resultsFile = `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
    writeFileSync(join(RESULTS_DIR, resultsFile), allRows.map(r => JSON.stringify(r)).join('\n') + '\n')
  }

  const report = renderReport({
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    summaries,
    skipped,
    resultsFile,
  })
  writeFileSync(REPORT_PATH, report + '\n')
  console.log(`\n[eval:live] 报告已刷新：eval/REPORT.md${resultsFile ? `；逐条结果：eval/results/${resultsFile}` : ''}`)

  if (!available.length) {
    console.log('[eval:live] 所有 provider 均不可用，本次未产生指标数据（这不是失败——live 基准是可选对照，不是门禁）。')
    console.log('[eval:live] 启用方式：export DEEPSEEK_API_KEY=sk-... 或安装并启动 Ollama（见 eval/README.md），然后重跑 npm run eval:live。')
    process.exit(0)
  }

  // 摘要打印
  console.log('')
  for (const s of summaries) {
    console.log(
      `[eval:live] ${s.provider}(${s.model})：type_match ${fmtRate(s.type_match, s.cases)}，首轮解析 ${fmtRate(s.parse_ok_first_try, s.cases)}，修复救回 ${fmtRate(s.repaired_rescue, s.cases)}，错误 ${fmtRate(s.errors, s.cases)}，p50 ${s.p50}ms / p95 ${s.p95}ms`,
    )
  }
}

main().catch(e => {
  console.error(`[eval:live] 未预期的异常：${e?.stack || e}`)
  process.exit(1)
})
