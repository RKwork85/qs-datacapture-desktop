/**
 * 冒烟：内嵌控制服 + 抖音搜索任务入队（不跑 Playwright）
 * 用法：node scripts/test-control-server.js
 */
const { startControlServer, isControlServerUp } = require("../server/index");

async function main() {
  const r = await startControlServer();
  console.log("startControlServer:", r);
  if (!(await isControlServerUp())) {
    throw new Error("control server not reachable");
  }

  const login = await fetch("http://127.0.0.1:3780/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const tok = await login.json();
  if (!tok.ok) throw new Error(`login: ${JSON.stringify(tok)}`);

  const task = await fetch("http://127.0.0.1:3780/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok.token}`,
    },
    body: JSON.stringify({
      type: "dy.crawl_search",
      params: {
        platform: "dy",
        kind: "search",
        keywords: ["api-test"],
        maxNotes: 3,
        limit: 3,
      },
      priority: 0,
    }),
  });
  const body = await task.json();
  if (!body.ok || !body.task) throw new Error(`create task: ${JSON.stringify(body)}`);
  console.log("dy.crawl_search queued:", body.task.id.slice(0, 8), body.task.status);

  const list = await fetch("http://127.0.0.1:3780/api/tasks", {
    headers: { Authorization: `Bearer ${tok.token}` },
  });
  const tasks = await list.json();
  const found = (tasks.tasks || []).find((t) => t.id === body.task.id);
  if (!found || found.status !== "pending") {
    throw new Error("task not in pending list");
  }
  console.log("OK: control-server + dy search enqueue");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
