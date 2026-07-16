/* Layer 1 golden 回放 —— 把 eval/fixtures/ 下手工撰写的「模型原始输出」逐条喂给
   parsePlanOutput，断言解析/校验结果与标注一致。确定性、零 API key、毫秒级，
   随 npm test 进 CI 门禁。方法论与 expect DSL 说明见 eval/README.md。

   fixture 结构：{ id, category, note?, raw: string | string[]（数组按 \n 拼接）,
   expect: { type, count?, ops?, errorIncludes?, items? } } */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlanOutput } from "../server/src/planLib.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "fixtures");
const EXPECT_KEYS = new Set(["type", "count", "ops", "errorIncludes", "items"]);
const MIN_CASES = 25;

/* ============ 加载 + fixture 自身的形状校验（防手滑写错标注） ============ */

const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith(".json")).sort();
const fixtures = [];
for (const file of files) {
  const cases = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"));
  assert.ok(Array.isArray(cases), `${file} 顶层必须是用例数组`);
  for (const c of cases) {
    assert.ok(c.id && typeof c.id === "string", `${file} 存在缺 id 的用例`);
    assert.ok(typeof c.raw === "string" || Array.isArray(c.raw), `${file}::${c.id} 的 raw 必须是字符串或行数组`);
    assert.ok(c.expect && typeof c.expect.type === "string", `${file}::${c.id} 缺 expect.type`);
    for (const k of Object.keys(c.expect)) {
      assert.ok(EXPECT_KEYS.has(k), `${file}::${c.id} 的 expect 含未知断言键 "${k}"（合法：${[...EXPECT_KEYS].join("/")}）`);
    }
    fixtures.push({ ...c, file });
  }
}

/* ============ 逐条回放 ============ */

let passed = 0;

for (const c of fixtures) {
  test(`golden ${c.file} :: ${c.id}`, () => {
    const raw = Array.isArray(c.raw) ? c.raw.join("\n") : c.raw;
    const r = parsePlanOutput(raw);
    const exp = c.expect;

    assert.equal(
      r.type,
      exp.type,
      `type 应为 ${exp.type}，实际 ${r.type}${r.type === "error" ? `（error：${r.error}）` : ""}`,
    );

    if (exp.errorIncludes !== undefined) {
      assert.equal(r.type, "error", "errorIncludes 只能配合 type=error 使用");
      const subs = Array.isArray(exp.errorIncludes) ? exp.errorIncludes : [exp.errorIncludes];
      for (const s of subs) {
        assert.ok(r.error.includes(s), `error 应包含「${s}」，实际：${r.error}`);
      }
    }

    const items = r.type === "proposals" ? r.proposals : r.type === "questions" ? r.questions : null;

    if (exp.count !== undefined) {
      assert.ok(items, "count 只能配合 type=proposals/questions 使用");
      assert.equal(items.length, exp.count, `条数应为 ${exp.count}，实际 ${items.length}`);
    }

    if (exp.ops !== undefined) {
      assert.equal(r.type, "proposals", "ops 只能配合 type=proposals 使用");
      assert.deepEqual(r.proposals.map(p => p.op), exp.ops, "op 序列不一致");
    }

    if (exp.items !== undefined) {
      assert.ok(items, "items 只能配合 type=proposals/questions 使用");
      for (const { at, fields } of exp.items) {
        assert.ok(items[at], `第 ${at} 条不存在（共 ${items.length} 条）`);
        for (const [k, v] of Object.entries(fields)) {
          assert.deepEqual(items[at][k], v, `第 ${at} 条的 ${k} 不一致`);
        }
      }
    }

    passed++;
  });
}

/* ============ 汇总（文件内测试串行执行，本条注册在最后必然最后跑） ============ */

test("golden 回放汇总", () => {
  const ids = new Set(fixtures.map(c => c.id));
  assert.equal(ids.size, fixtures.length, "fixture id 存在重复");
  assert.ok(fixtures.length >= MIN_CASES, `golden 用例至少 ${MIN_CASES} 个（当前 ${fixtures.length}）`);
  assert.equal(passed, fixtures.length, `${passed}/${fixtures.length} 通过`);
  console.log(`[planEval] ${fixtures.length} golden cases（${files.length} 个 fixture 文件），全部通过`);
});
