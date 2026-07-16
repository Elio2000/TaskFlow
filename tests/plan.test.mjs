import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBlocks,
  parsePlanOutput,
  validateProposals,
  validateQuestions,
  buildRepairMessages,
  formatProposalLine,
  formatQuestionLines,
} from "../server/src/planLib.ts";

/* ============ 块提取 ============ */

test("extractBlocks: 分别/同时提取 proposals 与 questions 块", () => {
  const raw = "好的：\n```proposals\n[1]\n```\n再问：\n```questions\n[2]\n```";
  assert.deepEqual(extractBlocks(raw), { proposals: "[1]", questions: "[2]" });
  assert.deepEqual(extractBlocks("没有块"), { proposals: null, questions: null });
  assert.deepEqual(extractBlocks("```questions\n[{\"q\":\"x\"}]\n```"), {
    proposals: null,
    questions: '[{"q":"x"}]',
  });
});

/* ============ 合法 proposals ============ */

test("parsePlanOutput: 合法 proposals（四种 op）", () => {
  const raw = `已拆解：
\`\`\`proposals
[{"op":"create","title":"复习线代","due_date":"2026-07-17","due_time":"14:00","priority":2,"description":"第3章"},
 {"op":"update","task_id":"tsk_1","due_date":"2026-07-20"},
 {"op":"complete","task_id":"tsk_2"},
 {"op":"delete","task_id":"tsk_3"}]
\`\`\``;
  const r = parsePlanOutput(raw);
  assert.equal(r.type, "proposals");
  assert.equal(r.proposals.length, 4);
  assert.equal(r.proposals[0].op, "create");
  assert.equal(r.proposals[0].title, "复习线代");
  assert.equal(r.proposals[1].task_id, "tsk_1");
});

test("parsePlanOutput: 未知字段透传（向后兼容，如 in_sprint）", () => {
  const raw = '```proposals\n[{"op":"create","title":"冲刺任务","in_sprint":1}]\n```';
  const r = parsePlanOutput(raw);
  assert.equal(r.type, "proposals");
  assert.equal(r.proposals[0].in_sprint, 1);
});

/* ============ 畸形 JSON / 枚举违规 ============ */

test("parsePlanOutput: 畸形 JSON → error", () => {
  const r = parsePlanOutput('```proposals\n[{"op":"create","title":]\n```');
  assert.equal(r.type, "error");
  assert.match(r.error, /JSON 解析失败/);
});

test("parsePlanOutput: 非数组 → error", () => {
  const r = parsePlanOutput('```proposals\n{"op":"create","title":"x"}\n```');
  assert.equal(r.type, "error");
  assert.match(r.error, /不是 JSON 数组/);
});

test("parsePlanOutput: op 枚举违规 → error", () => {
  const r = parsePlanOutput('```proposals\n[{"op":"rename","title":"x"}]\n```');
  assert.equal(r.type, "error");
  assert.match(r.error, /proposals 校验失败/);
});

test("parsePlanOutput: 字段违规（create 缺 title / 日期格式错 / priority 越界）→ error", () => {
  assert.equal(parsePlanOutput('```proposals\n[{"op":"create"}]\n```').type, "error");
  assert.equal(parsePlanOutput('```proposals\n[{"op":"create","title":"x","due_date":"明天"}]\n```').type, "error");
  assert.equal(parsePlanOutput('```proposals\n[{"op":"create","title":"x","priority":5}]\n```').type, "error");
  assert.equal(parsePlanOutput('```proposals\n[{"op":"complete"}]\n```').type, "error");
});

test("validateProposals: 空数组不合法", () => {
  const r = validateProposals([]);
  assert.equal(r.ok, false);
});

/* ============ questions ============ */

test("parsePlanOutput: 合法 questions 块", () => {
  const raw = `先确认：
\`\`\`questions
[{"q":"什么时间段健身？","options":["早上","晚上"]}]
\`\`\``;
  const r = parsePlanOutput(raw);
  assert.equal(r.type, "questions");
  assert.equal(r.questions[0].q, "什么时间段健身？");
  assert.deepEqual(r.questions[0].options, ["早上", "晚上"]);
});

test("validateQuestions: 缺 options / 空选项 → 不合法", () => {
  assert.equal(validateQuestions([{ q: "x" }]).ok, false);
  assert.equal(validateQuestions([{ q: "x", options: [] }]).ok, false);
  assert.equal(validateQuestions([{ q: "", options: ["a"] }]).ok, false);
});

/* ============ 两块并存 / 空输出 / 无块 ============ */

test("parsePlanOutput: 两块并存时 proposals 优先", () => {
  const raw = `\`\`\`proposals
[{"op":"create","title":"任务A"}]
\`\`\`
\`\`\`questions
[{"q":"确定吗？","options":["是","否"]}]
\`\`\``;
  const r = parsePlanOutput(raw);
  assert.equal(r.type, "proposals");
  assert.equal(r.proposals[0].title, "任务A");
});

test("parsePlanOutput: 空输出 → error", () => {
  assert.equal(parsePlanOutput("").type, "error");
  assert.equal(parsePlanOutput("   \n ").type, "error");
});

test("parsePlanOutput: 无任何块的纯文本 → error", () => {
  const r = parsePlanOutput("我觉得你应该先健身再买礼物。");
  assert.equal(r.type, "error");
  assert.match(r.error, /没有/);
});

test("parsePlanOutput: 裸 JSON 数组（无 fenced 块）按形状归类", () => {
  const p = parsePlanOutput('[{"op":"create","title":"裸数组任务"}]');
  assert.equal(p.type, "proposals");
  const q = parsePlanOutput('```json\n[{"q":"哪天？","options":["周六","周日"]}]\n```');
  assert.equal(q.type, "questions");
});

/* ============ 修复消息构造 ============ */

test("buildRepairMessages: 回灌原始输出 + 错误说明 + 只发块的指令", () => {
  const msgs = buildRepairMessages("坏输出", "JSON 解析失败：xxx");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "assistant");
  assert.equal(msgs[0].content, "坏输出");
  assert.equal(msgs[1].role, "user");
  assert.match(msgs[1].content, /JSON 解析失败：xxx/);
  assert.match(msgs[1].content, /只输出\*\*一个\*\* fenced 代码块/);
});

test("buildRepairMessages: 空原始输出时 assistant 消息用占位符（部分服务商拒绝空内容）", () => {
  const msgs = buildRepairMessages("", "模型输出为空");
  assert.equal(msgs[0].content, "（空输出）");
});

/* ============ 展示格式化 ============ */

test("formatProposalLine: 各 op 的一行摘要", () => {
  assert.equal(
    formatProposalLine({ op: "create", title: "复习线代", due_date: "2026-07-17", due_time: "14:00", priority: 2, description: "第3章" }),
    "[新建] 复习线代 📅2026-07-17 14:00 P2 — 第3章",
  );
  assert.equal(formatProposalLine({ op: "complete", task_id: "tsk_9" }), "[完成] (task_id:tsk_9)");
  assert.equal(formatProposalLine({ op: "create", title: "低优先", priority: 4 }), "[新建] 低优先");
});

test("formatQuestionLines: 编号 + 选项", () => {
  const s = formatQuestionLines([
    { q: "何时？", options: ["早", "晚"] },
    { q: "线上还是线下？", options: ["线上", "线下"] },
  ]);
  assert.match(s, /^1\. 何时？（选项：早 \/ 晚；也可自由回答）\n2\. /);
});
