import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../client/src/nlp.ts";

// 与 nlp.ts 内部 fmt 完全一致，按"测试运行时刻"同源计算，
// 这样日期断言断言绝对值却不会随时钟腐烂（明天跑也是绿的）。
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => fmt(new Date());
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return fmt(d);
};

test("解析综合：明天 + 时间 + 优先级 + #标签 + 标题", () => {
  const r = parse("明天下午2点 p1 #测试 买菜");
  assert.equal(r.title, "买菜");
  assert.equal(r.priority, 1);
  assert.deepEqual(r.label_ids, ["测试"]);
  assert.equal(r.due_time, "14:00");
  assert.equal(r.due_date, tomorrow());
});

test("解析「今天」为当天日期", () => {
  const r = parse("今天 写报告");
  assert.equal(r.title, "写报告");
  assert.equal(r.due_date, today());
  assert.equal(r.priority, null);
  assert.equal(r.due_time, null);
});

test("解析 p1~p4 优先级", () => {
  const r = parse("p3 重要");
  assert.equal(r.priority, 3);
  assert.equal(r.title, "重要");
  assert.equal(r.due_date, null);
});

test("解析 ! 语法优先级", () => {
  const r = parse("!2 紧急");
  assert.equal(r.priority, 2);
  assert.equal(r.title, "紧急");
});

test("解析重复规则，无日期时默认今天", () => {
  const r = parse("每天 喝水");
  assert.equal(r.repeat, "daily");
  assert.equal(r.due_date, today());
  assert.equal(r.title, "喝水");
});

test("解析多个 #标签", () => {
  const r = parse("买菜 #生活 #紧急");
  assert.deepEqual(r.label_ids, ["生活", "紧急"]);
  assert.equal(r.title, "买菜");
});

test("解析时间且无日期时默认今天（含半点）", () => {
  const r = parse("下午3点半 开会");
  assert.equal(r.due_time, "15:30");
  assert.equal(r.due_date, today());
  assert.equal(r.title, "开会");
});

test("空输入返回全空结果", () => {
  const r = parse("");
  assert.equal(r.title, "");
  assert.equal(r.due_date, null);
  assert.equal(r.due_time, null);
  assert.equal(r.priority, null);
  assert.deepEqual(r.label_ids, []);
  assert.equal(r.repeat, null);
});

test("无任何元数据时原样作为标题", () => {
  const r = parse("普通任务无元数据");
  assert.equal(r.title, "普通任务无元数据");
  assert.equal(r.due_date, null);
  assert.equal(r.priority, null);
  assert.equal(r.repeat, null);
  assert.deepEqual(r.label_ids, []);
});
