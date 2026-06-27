import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjectId, filterTasks, formatTask } from "../server/src/mcpLib.ts";

const projects = [
  { id: "inbox", name: "收件箱" },
  { id: "p1", name: "论文写作" },
  { id: "p2", name: "VLA 研究" },
];

test("resolveProjectId: by id, by name (case-insensitive), miss, empty", () => {
  assert.equal(resolveProjectId(projects, "p1"), "p1");          // exact id
  assert.equal(resolveProjectId(projects, "论文写作"), "p1");      // exact name
  assert.equal(resolveProjectId(projects, "  VLA 研究 "), "p2");  // trimmed name
  assert.equal(resolveProjectId(projects, "不存在"), null);
  assert.equal(resolveProjectId(projects, ""), null);
  assert.equal(resolveProjectId(projects, undefined), null);
});

const TODAY = "2026-06-18";
const tasks = [
  { id: "a", title: "今天的", project_id: "p1", due_date: "2026-06-18", completed: 0, priority: 2 },
  { id: "b", title: "逾期的", project_id: "p1", due_date: "2026-06-10", completed: 0, priority: 4 },
  { id: "c", title: "未来的", project_id: "p2", due_date: "2026-06-25", completed: 0, priority: 1 },
  { id: "d", title: "收件箱无期", project_id: "inbox", due_date: null, completed: 0, priority: 4 },
  { id: "e", title: "已完成今天", project_id: "p1", due_date: "2026-06-18", completed: 1, priority: 4 },
  { id: "f", title: "子任务", project_id: "p1", parent_id: "a", due_date: "2026-06-18", completed: 0, priority: 4 },
];

test("filterTasks: today excludes completed + subtasks by default", () => {
  const r = filterTasks(tasks, { filter: "today" }, TODAY).map(t => t.id);
  assert.deepEqual(r, ["a"]); // not e (completed), not f (subtask)
});

test("filterTasks: include_completed brings completed back", () => {
  const r = filterTasks(tasks, { filter: "today", includeCompleted: true }, TODAY).map(t => t.id).sort();
  assert.deepEqual(r, ["a", "e"]);
});

test("filterTasks: overdue = past due and not done", () => {
  assert.deepEqual(filterTasks(tasks, { filter: "overdue" }, TODAY).map(t => t.id), ["b"]);
});

test("filterTasks: upcoming = due today or later", () => {
  assert.deepEqual(filterTasks(tasks, { filter: "upcoming" }, TODAY).map(t => t.id).sort(), ["a", "c"]);
});

test("filterTasks: inbox = project_id inbox", () => {
  assert.deepEqual(filterTasks(tasks, { filter: "inbox" }, TODAY).map(t => t.id), ["d"]);
});

test("filterTasks: all (default) = every top-level incomplete task", () => {
  assert.deepEqual(filterTasks(tasks, {}, TODAY).map(t => t.id).sort(), ["a", "b", "c", "d"]);
});

test("filterTasks: projectId narrows to one project", () => {
  assert.deepEqual(filterTasks(tasks, { filter: "all", projectId: "p1" }, TODAY).map(t => t.id).sort(), ["a", "b"]);
});

test("formatTask: status/project/due/priority/id", () => {
  assert.equal(
    formatTask({ id: "a", title: "今天的", project_id: "p1", due_date: "2026-06-18", completed: 0, priority: 2 }, "论文写作"),
    "○ 今天的 [论文写作] 📅2026-06-18 P2 (id:a)",
  );
  assert.equal(
    formatTask({ id: "d", title: "无期", project_id: "inbox", due_date: null, completed: 1, priority: 4 }),
    "✓ 无期 (id:d)",
  );
});
