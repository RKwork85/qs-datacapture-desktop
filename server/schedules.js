const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getControlServerDataDir } = require("../core/paths");

function schedulesPath() {
  return path.join(getControlServerDataDir(), "schedules.json");
}

/** @typedef {"2min"|"10min"|"1hour"|"at"|"hourly"} FrequencyKey */
/** @typedef {"hot"|"detail"|"comments"} WeiboStep */

const FREQUENCIES = new Set(["2min", "10min", "1hour", "at", "hourly"]);
const WEIBO_STEPS = new Set(["hot", "detail", "comments"]);

function ensure() {
  fs.mkdirSync(getControlServerDataDir(), { recursive: true });
  const file = schedulesPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ schedules: [] }, null, 2), "utf8");
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(schedulesPath(), "utf8"));
}

function write(data) {
  ensure();
  fs.writeFileSync(schedulesPath(), JSON.stringify(data, null, 2), "utf8");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function fmtLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

/**
 * 计算下次执行时间（本地时区）。
 * @param {FrequencyKey} frequency
 * @param {{ atTime?: string, from?: number }} opts atTime: ISO 或 `YYYY-MM-DDTHH:mm` / `HH:mm`
 */
function computeNextRunAt(frequency, { atTime = "", from = Date.now() } = {}) {
  const base = from;
  if (frequency === "2min") return base + 2 * 60 * 1000;
  if (frequency === "10min") return base + 10 * 60 * 1000;
  if (frequency === "1hour") return base + 60 * 60 * 1000;

  if (frequency === "hourly") {
    const d = new Date(base);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }

  // 定时爬取：指定时刻；跑完后按「每天同一时刻」续期（若仍启用）
  const raw = String(atTime || "").trim();
  if (!raw) return base + 60 * 60 * 1000;

  let target = NaN;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hh, mm] = raw.split(":").map((x) => Number(x));
    const d = new Date(base);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= base) d.setDate(d.getDate() + 1);
    target = d.getTime();
  } else {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      if (parsed > base) target = parsed;
      else {
        const d = new Date(parsed);
        const next = new Date(base);
        next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        if (next.getTime() <= base) next.setDate(next.getDate() + 1);
        target = next.getTime();
      }
    }
  }
  if (!Number.isFinite(target)) return base + 60 * 60 * 1000;
  return target;
}

function listSchedules({ platform } = {}) {
  let rows = read().schedules || [];
  if (platform) rows = rows.filter((s) => s.platform === platform);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getSchedule(id) {
  return (read().schedules || []).find((s) => s.id === id) || null;
}

function createSchedule(input = {}) {
  const platform = String(input.platform || "weibo").trim() || "weibo";
  const step = String(input.step || "hot").trim();
  const frequency = String(input.frequency || "1hour").trim();
  if (platform === "weibo" && !WEIBO_STEPS.has(step)) {
    throw new Error(`无效步骤: ${step}`);
  }
  if (!FREQUENCIES.has(frequency)) throw new Error(`无效频率: ${frequency}`);
  if (frequency === "at" && !String(input.atTime || "").trim()) {
    throw new Error("定时爬取需填写执行时间");
  }

  const now = Date.now();
  const nextRunAt = computeNextRunAt(frequency, { atTime: input.atTime, from: now });
  const data = read();
  const row = {
    id: uuidv4(),
    name: String(input.name || "").trim() || defaultName(platform, step),
    platform,
    step,
    frequency,
    atTime: frequency === "at" ? String(input.atTime || "").trim() : "",
    params: input.params && typeof input.params === "object" ? input.params : {},
    enabled: input.enabled !== false,
    nextRunAt,
    lastRunAt: 0,
    lastStatus: "",
    lastError: "",
    lastTaskId: "",
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.schedules.unshift(row);
  write(data);
  return row;
}

function defaultName(platform, step) {
  if (platform === "weibo") {
    const map = { hot: "微博热搜榜", detail: "微博榜单详情", comments: "微博榜单评论区" };
    return map[step] || "微博定时任务";
  }
  return `${platform} 定时任务`;
}

function updateSchedule(id, patch = {}) {
  const data = read();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const prev = data.schedules[idx];
  const next = { ...prev, ...patch, id: prev.id, updatedAt: new Date().toISOString() };

  if (patch.frequency || patch.atTime !== undefined || patch.enabled === true) {
    const frequency = next.frequency;
    if (!FREQUENCIES.has(frequency)) throw new Error(`无效频率: ${frequency}`);
    if (frequency === "at" && !String(next.atTime || "").trim()) {
      throw new Error("定时爬取需填写执行时间");
    }
    if (patch.enabled === true || patch.frequency || patch.atTime !== undefined) {
      next.nextRunAt = computeNextRunAt(frequency, {
        atTime: next.atTime,
        from: Date.now(),
      });
    }
  }

  data.schedules[idx] = next;
  write(data);
  return next;
}

function deleteSchedule(id) {
  const data = read();
  const before = data.schedules.length;
  data.schedules = (data.schedules || []).filter((s) => s.id !== id);
  write(data);
  return before !== data.schedules.length;
}

/**
 * 找出到期且启用的任务，推进 nextRunAt，返回待入队列表。
 * 注意：不在此处写 lastRunAt（最近执行时间以任务真正结束为准）。
 */
function takeDueSchedules(now = Date.now()) {
  const data = read();
  const due = [];
  for (let i = 0; i < (data.schedules || []).length; i += 1) {
    const s = data.schedules[i];
    if (!s.enabled) continue;
    if (!s.nextRunAt || s.nextRunAt > now) continue;
    const nextRunAt = computeNextRunAt(s.frequency, { atTime: s.atTime, from: now + 1000 });
    data.schedules[i] = {
      ...s,
      nextRunAt,
      lastStatus: "queued",
      lastError: "",
      updatedAt: new Date().toISOString(),
    };
    due.push({ ...data.schedules[i] });
  }
  if (due.length) write(data);
  return due;
}

/**
 * 更新定时任务最近一次执行结果。
 * - queued/running：仅标记进行中，不改 lastRunAt / runCount
 * - done/failed：写入完成时间 lastRunAt，并累加 runCount
 */
function markScheduleResult(id, { taskId = "", status = "", error = "" } = {}) {
  const data = read();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const s = data.schedules[idx];
  const st = String(status || "").trim();
  const finished = st === "done" || st === "failed";
  data.schedules[idx] = {
    ...s,
    lastTaskId: taskId || s.lastTaskId,
    lastStatus: st || s.lastStatus,
    lastError: error || "",
    // 最近时间只在真正结束时更新；进行中保留上一次完成时间
    lastRunAt: finished ? Date.now() : s.lastRunAt || 0,
    runCount: (s.runCount || 0) + (finished ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
  write(data);
  return data.schedules[idx];
}

function pipelineTypeFor(platform) {
  if (platform === "weibo") return "weibo.pipeline";
  return `${platform}.pipeline`;
}

function pipelineParams(schedule) {
  return {
    ...(schedule.params || {}),
    endStep: schedule.step,
    __scheduleId: schedule.id,
    __auto: true,
    __scheduleName: schedule.name,
  };
}

module.exports = {
  FREQUENCIES,
  WEIBO_STEPS,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  takeDueSchedules,
  markScheduleResult,
  computeNextRunAt,
  pipelineTypeFor,
  pipelineParams,
  fmtLocal,
};
