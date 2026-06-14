import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskLabels } from "../client/src/utils/labels.ts";

test("解析正常 JSON 数组", () => {
  assert.deepEqual(parseTaskLabels('["生活","紧急"]'), ["生活", "紧急"]);
});

test("解析双重编码（P8-003 回归）", () => {
  const doubleEncoded = JSON.stringify(JSON.stringify(["test"]));
  assert.deepEqual(parseTaskLabels(doubleEncoded), ["test"]);
});

test("空字符串返回空数组", () => {
  assert.deepEqual(parseTaskLabels(""), []);
});

test("非法 JSON 返回空数组", () => {
  assert.deepEqual(parseTaskLabels("not json"), []);
});

test("字符串 'null' 返回空数组", () => {
  assert.deepEqual(parseTaskLabels("null"), []);
});

test("过滤数组中的非字符串元素", () => {
  assert.deepEqual(parseTaskLabels('["a",1,null,"b"]'), ["a", "b"]);
});
