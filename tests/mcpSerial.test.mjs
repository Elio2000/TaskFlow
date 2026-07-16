/* MCP 写操作串行化的进程级复现测试。
   背景：MCP TS SDK 对并发到达的 tools/call 是 fire-and-forget 派发（protocol 层
   _onrequest 不 await handler）。修复前，客户端批量注入 create_project + create_task
   时，create_task 的项目解析会抢在 create_project 完成前执行而失败（本测试在修复前
   的代码上会失败——"找不到项目"，且 mock 观察到 tasks 写先于 projects 写完成）。
   修复：mcp.ts 的 serialWrite 把写工具 handler 串到一条 promise 链上。 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

test("MCP 写操作串行：批量注入时 create_task 不再抢跑未完成的 create_project", async () => {
  /* ---- mock TaskFlow REST：POST /projects 故意慢 200ms，制造竞态窗口 ---- */
  const events = [];
  const projects = [{ id: "inbox", name: "收件箱", archived: 0 }];
  const mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "GET" && req.url === "/api/projects") return send(200, projects);
      if (req.method === "POST" && req.url === "/api/projects") {
        events.push("projects:start");
        await new Promise((r) => setTimeout(r, 200));
        const p = { id: "p1", name: JSON.parse(body).name, archived: 0 };
        projects.push(p);
        events.push("projects:end");
        return send(200, p);
      }
      if (req.method === "POST" && req.url === "/api/tasks") {
        events.push("tasks:start");
        return send(200, { id: "t1", completed: 0, priority: 4, ...JSON.parse(body) });
      }
      return send(404, { error: `mock 未实现: ${req.method} ${req.url}` });
    });
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const port = mock.address().port;

  /* ---- 拉起真实 MCP server（tsx 直跑 TS 源码），指向 mock REST ---- */
  const tsx = path.join(repoRoot, "server/node_modules/.bin/tsx");
  const child = spawn(tsx, [path.join(repoRoot, "server/src/mcp.ts")], {
    env: { ...process.env, TASKFLOW_API: `http://127.0.0.1:${port}/api` },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });

  try {
    /* ---- 一次性批量注入（不等前一个响应），复现原始竞态触发方式 ---- */
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "serial-test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: "求职" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_task", arguments: { title: "投简历", project: "求职" } } },
    ];
    child.stdin.write(batch.map((m) => JSON.stringify(m)).join("\n") + "\n");

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (lines.some((l) => l.id === 2) && lines.some((l) => l.id === 3)) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const r2 = lines.find((l) => l.id === 2);
    const r3 = lines.find((l) => l.id === 3);
    assert.ok(r2 && r3, `20s 内未收齐响应，已收到：${JSON.stringify(lines)}`);

    const text3 = r3.result?.content?.[0]?.text ?? "";
    assert.ok(!r3.result?.isError, `create_task 不应失败，实际返回：${text3}`);
    assert.ok(text3.includes("已创建任务"), `期望创建成功文案，实际：${text3}`);

    // 关键顺序断言：项目写入完成之后，任务写入才开始
    const pEnd = events.indexOf("projects:end");
    const tStart = events.indexOf("tasks:start");
    assert.ok(pEnd !== -1 && tStart !== -1, `mock 未观察到完整事件序列：${events.join(" → ")}`);
    assert.ok(pEnd < tStart, `期望 projects:end 先于 tasks:start，实际：${events.join(" → ")}`);
  } finally {
    child.kill();
    mock.close();
  }
});
