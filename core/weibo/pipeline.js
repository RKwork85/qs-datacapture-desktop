const { createLogger } = require("../logger");
const { stamp } = require("../paths");
const { fetchHotSearchToCsv } = require("./hot-search");
const { runDaily } = require("./run-daily");

const STEP_ORDER = ["hot", "detail", "comments"];
const STEP_LABEL = { hot: "热搜榜", detail: "榜单详情", comments: "榜单评论区" };
const STEP_SERIAL = { hot: "01", detail: "02", comments: "03" };

function normalizeEndStep(endStep) {
  const s = String(endStep || "hot").trim().toLowerCase();
  if (STEP_ORDER.includes(s)) return s;
  if (s === "comment" || s === "comment_zone") return "comments";
  return "hot";
}

function safeFilePart(text, fallback = "定时") {
  const raw = String(text || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 40);
  return raw || fallback;
}

/**
 * 定时产物命名：定时_英文类型_时间戳
 * 例：定时_hot_20261101_031928
 */
function buildScheduleFileStem({ endStep = "hot" } = {}) {
  const step = normalizeEndStep(endStep);
  return `${safeFilePart(`定时_${step}`, `定时_${step}`)}_${stamp()}`;
}

/**
 * 按标签终点顺序执行微博采集链：
 * hot → 仅热搜；detail → 热搜+详情；comments → 热搜+详情+评论区。
 */
async function runPipeline({
  endStep = "hot",
  hotLimit = 10,
  realtimeLimit = 50,
  maxTopics = 0,
  delaySec = 0.4,
  workers = 2,
  commentPosts = 3,
  commentTop = 100,
  onLog,
  __scheduleName = "",
  scheduleName = "",
  ...rest
} = {}) {
  const log = createLogger(onLog);
  const step = normalizeEndStep(endStep);
  const chain = STEP_ORDER.slice(0, STEP_ORDER.indexOf(step) + 1);
  const fileStem = buildScheduleFileStem({ endStep: step });
  if (__scheduleName || scheduleName) {
    log.info(`[pipeline] 定时任务: ${__scheduleName || scheduleName}`);
  }
  log.info(`[pipeline] 终点=${step}(${STEP_SERIAL[step]}) · 将顺序执行: ${chain.join(" → ")}`);
  log.info(`[pipeline] 产物命名: ${fileStem}`);

  if (step === "hot") {
    const result = await fetchHotSearchToCsv({
      limit: realtimeLimit,
      onLog,
      fileStem,
      ...rest,
    });
    return { ok: true, endStep: step, chain, fileStem, hot: result };
  }

  if (step === "detail") {
    const result = await runDaily({
      hotLimit,
      realtimeLimit,
      maxTopics,
      delaySec,
      workers,
      commentPosts,
      commentTop,
      skipCommentZone: true,
      onLog,
      fileStem,
      ...rest,
    });
    return { ok: true, endStep: step, chain, fileStem, ...result };
  }

  const result = await runDaily({
    hotLimit,
    realtimeLimit,
    maxTopics,
    delaySec,
    workers,
    commentPosts,
    commentTop,
    skipCommentZone: false,
    onLog,
    fileStem,
    ...rest,
  });
  return { ok: true, endStep: step, chain, fileStem, ...result };
}

module.exports = {
  runPipeline,
  normalizeEndStep,
  STEP_ORDER,
  STEP_LABEL,
  STEP_SERIAL,
  buildScheduleFileStem,
};
