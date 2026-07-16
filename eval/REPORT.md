# TaskFlow plan_tasks — live 基准报告

> 本文件由 `npm run eval:live` 自动生成/刷新，请勿手改。指标口径见 [eval/README.md](README.md)。

- 生成时间：2026-07-16T09:53:56.938Z
- 标注集：`eval/cases.jsonl`（26 条；约半数信息充分应出 proposals，半数刻意模糊应出 questions）
- 逐条原始结果：本次无（所有 provider 均被跳过）

| Provider | Model | 状态 | cases | type_match_rate | parse_ok_first_try | repaired_rescue_rate | error_rate | p50 延迟 | p95 延迟 |
|---|---|---|---|---|---|---|---|---|---|
| deepseek | — | skip：未设置 TASKFLOW_AI_KEY / DEEPSEEK_API_KEY | — | — | — | — | — | — | — |
| ollama | — | skip：http://localhost:11434 不可达（未安装或未启动，安装见 eval/README.md） | — | — | — | — | — | — | — |

本次运行**没有产生任何指标数据**——所有 provider 均不可用（原因见上表）。
配好 DeepSeek Key 或启动本地 Ollama 后重跑 `npm run eval:live`，本报告会被真实数据覆盖；配置方法见 [eval/README.md](README.md)。

