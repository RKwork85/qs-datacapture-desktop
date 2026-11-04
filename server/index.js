const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const { loadConfig } = require("../core/paths");
const store = require("./store");
const schedules = require("./schedules");

const cfg = loadConfig().controlServer;
const PORT = cfg.port || 3780;
const HOST = cfg.host || "127.0.0.1";
const SECRET = cfg.jwtSecret || "dev-secret";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const clients = new Map(); // clientId -> ws

const ALLOWED_TASK_TYPES = new Set([
  "dy.login",
  "dy.fetch_profile",
  "dy.fetch_media",
  "dy.fetch_aweme",
  "dy.fetch_search",
  "dy.publish_note",
  "dy.publish_video",
  "dy.crawl_batch",
  "dy.crawl_search",
  "xhs.login",
  "xhs.fetch_profile",
  "xhs.fetch_media",
  "xhs.fetch_note",
  "xhs.fetch_search",
  "xhs.publish_note",
  "xhs.publish_video",
  "xhs.crawl_batch",
  "xhs.crawl_search",
  "weibo.login",
  "weibo.hot",
  "weibo.detail",
  "weibo.comments",
  "weibo.daily",
  "weibo.pipeline",
  "weibo.crawl_batch",
  "weibo.crawl_search",
]);

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "missing token" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "invalid token" });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "qs-datacapture-control", version: loadConfig().version });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = (cfg.users || []).find(
    (u) => u.username === username && u.password === password
  );
  if (!user) return res.status(401).json({ ok: false, error: "账号或密码错误" });
  const token = jwt.sign({ sub: user.username, role: "agent" }, SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token, username: user.username });
});

app.get("/api/version/latest", (_req, res) => {
  res.json({ ok: true, ...(cfg.latestVersion || {}) });
});

app.get("/api/tasks", authMiddleware, (req, res) => {
  const status = req.query.status || "";
  res.json({ ok: true, tasks: store.listTasks({ status: status || undefined }) });
});

app.post("/api/tasks", authMiddleware, (req, res) => {
  const { type, params, priority } = req.body || {};
  if (!type) return res.status(400).json({ ok: false, error: "type required" });
  if (!ALLOWED_TASK_TYPES.has(type)) {
    return res.status(400).json({ ok: false, error: `任务类型不在白名单: ${type}` });
  }
  const task = store.createTask({ type, params: params || {}, priority: priority || 0 });
  broadcast({ event: "task.created", task });
  res.json({ ok: true, task });
});

app.post("/api/agent/poll", authMiddleware, (req, res) => {
  const clientId = req.body?.clientId || req.user.sub;
  const preferId = req.body?.taskId || "";
  const task = preferId
    ? store.claimTask(preferId, clientId) || store.claimNextTask(clientId)
    : store.claimNextTask(clientId);
  const version = cfg.latestVersion || {};
  res.json({
    ok: true,
    task,
    version,
    serverTime: new Date().toISOString(),
  });
});

app.post("/api/agent/result", authMiddleware, (req, res) => {
  const { taskId, status, result, error } = req.body || {};
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId required" });
  const task = store.updateTask(taskId, {
    status: status === "failed" ? "failed" : "done",
    result: result || null,
    error: error || "",
  });
  if (!task) return res.status(404).json({ ok: false, error: "task not found" });
  const scheduleId = task.params && task.params.__scheduleId;
  let schedule = null;
  if (scheduleId) {
    schedule = schedules.markScheduleResult(scheduleId, {
      taskId,
      status: task.status,
      error: task.error || "",
    });
    if (schedule) broadcast({ event: "schedule.updated", schedule });
  }
  broadcast({ event: "task.updated", task });
  res.json({ ok: true, task, schedule });
});

/* ---------------- 定时任务（分平台） ---------------- */

app.get("/api/schedules", authMiddleware, (req, res) => {
  const platform = req.query.platform || "";
  res.json({
    ok: true,
    schedules: schedules.listSchedules({ platform: platform || undefined }),
  });
});

app.post("/api/schedules", authMiddleware, (req, res) => {
  try {
    const row = schedules.createSchedule(req.body || {});
    broadcast({ event: "schedule.updated", schedule: row });
    res.json({ ok: true, schedule: row });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.patch("/api/schedules/:id", authMiddleware, (req, res) => {
  try {
    const row = schedules.updateSchedule(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: "not found" });
    broadcast({ event: "schedule.updated", schedule: row });
    res.json({ ok: true, schedule: row });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.delete("/api/schedules/:id", authMiddleware, (req, res) => {
  const ok = schedules.deleteSchedule(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: "not found" });
  broadcast({ event: "schedule.deleted", id: req.params.id });
  res.json({ ok: true });
});

/** 立即触发一次（入队，不改频率节奏以外的 nextRun 由调用方可选） */
app.post("/api/schedules/:id/run", authMiddleware, (req, res) => {
  const row = schedules.getSchedule(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: "not found" });
  const task = enqueueSchedule(row, { force: true });
  res.json({ ok: true, task, schedule: schedules.getSchedule(row.id) });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const ws of clients.values()) {
    if (ws.readyState === 1) ws.send(text);
  }
}

function enqueueSchedule(row, { force = false } = {}) {
  const type = schedules.pipelineTypeFor(row.platform);
  if (!ALLOWED_TASK_TYPES.has(type)) {
    throw new Error(`平台流水线未接入: ${type}`);
  }
  const task = store.createTask({
    type,
    params: schedules.pipelineParams(row),
    priority: 80,
  });
  schedules.markScheduleResult(row.id, {
    taskId: task.id,
    status: "queued",
    error: "",
  });
  broadcast({ event: "task.created", task });
  broadcast({ event: "schedule.fired", schedule: schedules.getSchedule(row.id), task, force });
  return task;
}

function tickSchedules() {
  try {
    const due = schedules.takeDueSchedules(Date.now());
    for (const row of due) {
      try {
        enqueueSchedule(row);
        console.log(
          `[scheduler] fired ${row.platform}/${row.step} «${row.name}» → next ${schedules.fmtLocal(
            schedules.getSchedule(row.id)?.nextRunAt || 0
          )}`
        );
      } catch (e) {
        console.warn(`[scheduler] enqueue failed: ${e.message || e}`);
        schedules.markScheduleResult(row.id, { status: "failed", error: String(e.message || e) });
      }
    }
  } catch (e) {
    console.warn(`[scheduler] tick error: ${e.message || e}`);
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const token = url.searchParams.get("token") || "";
  let user = null;
  try {
    user = jwt.verify(token, SECRET);
  } catch {
    ws.close(1008, "unauthorized");
    return;
  }
  const clientId = `${user.sub}-${Date.now()}`;
  clients.set(clientId, ws);
  ws.send(JSON.stringify({ event: "connected", clientId }));

  ws.on("message", (buf) => {
    let msg = null;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (msg?.type === "ping") {
      ws.send(JSON.stringify({ event: "pong", t: Date.now() }));
    }
    if (msg?.type === "claim") {
      const task = store.claimNextTask(clientId);
      ws.send(JSON.stringify({ event: "task", task }));
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
  });
});

let schedulerInterval = null;
let listening = false;

function healthUrl() {
  return `http://${HOST}:${PORT}/api/health`;
}

async function isControlServerUp() {
  try {
    const resp = await fetch(healthUrl(), { signal: AbortSignal.timeout(2500) });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.ok === true && data?.service === "qs-datacapture-control";
  } catch {
    return false;
  }
}

/**
 * 启动本机控制服。若 3780 上已是本服务则跳过（开发态 npm run server + Electron 并存）。
 * @returns {Promise<{ ok: boolean, started?: boolean, skipped?: boolean, error?: string }>}
 */
async function startControlServer() {
  if (listening) return { ok: true, started: false, skipped: true };

  if (await isControlServerUp()) {
    return { ok: true, skipped: true, external: true };
  }

  return new Promise((resolve) => {
    const onListen = () => {
      listening = true;
      console.log(`[control-server] http://${HOST}:${PORT}`);
      console.log(`[control-server] ws://${HOST}:${PORT}/ws`);
      console.log(`[control-server] default user: admin / admin123`);
      tickSchedules();
      if (!schedulerInterval) {
        schedulerInterval = setInterval(tickSchedules, 15_000);
      }
      console.log(`[control-server] scheduler tick every 15s`);
      resolve({ ok: true, started: true });
    };

    const onError = (err) => {
      if (err && err.code === "EADDRINUSE") {
        isControlServerUp().then((up) => {
          if (up) resolve({ ok: true, skipped: true, external: true });
          else resolve({ ok: false, error: `端口 ${PORT} 已被占用且非本控制服` });
        });
        return;
      }
      resolve({ ok: false, error: String(err.message || err) });
    };

    server.once("error", onError);
    server.listen(PORT, HOST, onListen);
  });
}

module.exports = { startControlServer, isControlServerUp, healthUrl };

if (require.main === module) {
  startControlServer().then((r) => {
    if (!r.ok) {
      console.error("[control-server] 启动失败:", r.error);
      process.exit(1);
    }
    if (r.skipped && r.external) {
      console.log("[control-server] 3780 已有实例，本进程保持运行（供 npm run dev 使用）");
      setInterval(() => {}, 60 * 60 * 1000);
    }
  });
}
