# plan_tasks 评测体系（两层）

TaskFlow 的 AI 出口只有一个：一次性规划调用返回的结构化结果（```proposals``` / ```questions``` fenced 块 → zod 校验 → 判别联合）。这套协议的可靠性 = 产品可靠性，所以为它建了两层互补的评测：

| | Layer 1：golden 回放 | Layer 2：live 基准 |
|---|---|---|
| 被测对象 | `planLib.parsePlanOutput`（纯函数解析/校验层） | 端到端 `/api/plan`（提示词 + 真模型 + 解析 + 修复轮） |
| 输入 | `fixtures/` 里手工撰写的「模型原始输出」 | `cases.jsonl` 里手工撰写的自然语言规划请求 |
| 确定性 | 完全确定，零 API key，毫秒级 | 依赖真模型，有成本、有波动 |
| 运行时机 | 随 `npm test` 进 CI，**是门禁** | `npm run eval:live` 手动跑，**是对照实验，不是门禁** |
| 回答的问题 | 解析层对各种跑偏形态的行为是否回归？ | 协议 + 修复机制在不同强度的模型上各撑得怎么样？ |

**为什么这样分层**：把不确定性隔离在该在的层。解析层的行为（包括对锐边的处理）必须逐字节可复现，才能放进 CI 当门禁——所以 Layer 1 把真实世界的跑偏形态（裸数组、`json` 围栏、全角标点、嵌套围栏陷阱……）固化成 golden 用例，改解析逻辑时任何行为变化都会被点名。而「模型多久跑偏一次、跑偏后修复轮能救回多少」天然是统计问题，进不了门禁，就用 Layer 2 定期量化。

**为什么强 vs 弱模型对照**：协议约束 + 一轮修复重试的工程价值，在强模型（DeepSeek）上几乎不可见——它基本一次过。价值要在弱模型（本地 Ollama 小模型）上才显形：首轮解析成功率掉下来，`repaired_rescue_rate` 顶上去多少，才是这套机制「让弱模型也可用」的证据；同时弱模型是免费本地的回归靶子，不花 API 钱也能跑全量。

## Layer 1：golden 回放

- 用例：`eval/fixtures/*.json`（按类别分文件），每个用例 `{ id, category, note?, raw, expect }`：
  - `raw`：手工撰写的模型原始输出，字符串或**行数组**（数组按 `\n` 拼接，好读好 diff）；
  - `expect`：`type`（必填，`proposals|questions|error`）+ 可选断言：
    - `count` — proposals/questions 条数
    - `ops` — proposals 的 op 精确序列，如 `["create","update"]`
    - `errorIncludes` — error 文案必须包含的子串（字符串或数组）
    - `items` — `[{ at, fields }]`，断言第 `at` 条的若干字段值（深比较）
- 运行器：`tests/planEval.test.mjs`，随 `npm test` 全量回放（每个 fixture 一个测试 + 末尾一行汇总），并校验 fixture 自身形状（未知断言键、重复 id、少于 25 条都会红）。
- **加用例**：往对应类别的 JSON 文件里加一条（或新建类别文件，运行器自动发现 `fixtures/*.json`）。原则：`raw` 必须像真实模型输出（中文、带块外废话、带真实跑偏），禁止占位符；预期以**当前实际行为**为准——先跑一次看结果，确认行为合理再固化。
- **改解析行为**：golden 用例挂红是预期功能。先改 fixture 里的 `expect`（把行为变化写成 diff 可见的标注变更），再改 `planLib.ts`。

## Layer 2：live 基准

- 标注集：`eval/cases.jsonl`，每行 `{ id, brain_dump, expect_type }`。约半数信息充分（应直出 proposals），半数刻意缺关键信息（应触发 questions 澄清）——`expect_type` 就是「澄清触发准确率」的标注。
- 运行：确保 TaskFlow 在跑（`npm run dev` 或 `npm start`），然后 `npm run eval:live`。脚本纯 Node 零依赖，逐 provider × 逐 case 串行打 `POST /api/plan`（不传 `project_id`，即跨项目快照上下文）。
- 输出：`eval/results/<时间戳>.jsonl` 逐条原始结果（**不入库**）+ 刷新 `eval/REPORT.md` 指标矩阵（**入库**，保留最近一次运行的诚实快照，包括谁被 skip）。

### 指标口径

分母统一为该 provider 实际执行的全部 case 数（26）：

| 指标 | 定义 |
|---|---|
| `type_match_rate` | 返回 type 与标注 `expect_type` 一致的占比——澄清触发准确率（含把该反问的直接出计划、把该出计划的拿去反问，两种都算 miss） |
| `parse_ok_first_try` | `type ≠ error` 且 `!meta.repaired`——首轮输出直接解析通过的占比 |
| `repaired_rescue_rate` | `meta.repaired` 且 `type ≠ error`——首轮跑偏、被修复轮救回的占比（注意分母是全部 case，不是失败 case） |
| `error_rate` | `type = error`——两轮都没救回来（或网络/服务失败）的占比 |
| `p50 / p95 延迟` | `meta.latencyMs`（服务端计时，含重试与修复轮）的最近秩分位数；传输层失败时退回客户端计时 |

`type_match_rate` 看**规划判断力**，后三个看**协议服从性**，二者独立——弱模型常见「格式全对但从不反问」，强模型偶见「判断准但围栏跑偏被修复轮拉回」。

### 配置 provider

**DeepSeek**（或任何 OpenAI 兼容云端服务）：

```bash
export DEEPSEEK_API_KEY=sk-...      # 或 TASKFLOW_AI_KEY（两者取其一，前者只被本脚本读取）
# 可选：DEEPSEEK_BASE_URL / AI_PLANNER_MODEL 换网关与模型
npm run eval:live
```

**Ollama**（本地弱模型对照）：

```bash
brew install ollama                  # macOS；其他平台见 https://ollama.com/download
ollama serve                         # 默认 11434 端口
ollama pull qwen2.5:3b               # 任一小模型；脚本优选 qwen* > llama* > 列表第一个
npm run eval:live                    # 可用 OLLAMA_URL 覆盖端口
```

两个 provider 谁不在就 skip 谁（报告里如实标注原因）；都不在时打印说明并 `exit 0`——skip 不是失败。

## 加新协议怎么办

新增第三种 fenced 协议时（见 CLAUDE.md 的三处同步约定），评测侧同步两件事：Layer 1 加一组该协议的 golden fixture（干净 / 畸形 / 与旧块并存的优先级），Layer 2 视语义决定是否扩展 `expect_type` 标注。
