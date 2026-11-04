const fs = require("fs");
const path = require("path");
const { WEIBO_DATA_DIR, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const { authFileLooksValid, WEIBO_AUTH_PATH } = require("./auth");
const {
  fetchHotSearch,
  fetchTopicReadCount,
  normalizeRows,
  saveCsv,
} = require("./hot-search");
const { fetchAllTopicsDetailHttp } = require("./detail-http");
const { collectCommentZone } = require("./comment-zone");
const { exportWorkbook, HOT_HEADERS } = require("./export-excel");

function fmtSec(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toFixed(1).padStart(4, "0")}s`;
}

async function runDaily({
  hotLimit = 10,
  realtimeLimit = 50,
  maxTopics = 0,
  delaySec = 0.4,
  workers = 2,
  commentPosts = 3,
  commentTop = 100,
  skipCommentZone = false,
  dataDir = WEIBO_DATA_DIR,
  onLog,
  fileStem = "",
} = {}) {
  const log = createLogger(onLog);
  const batchId = stamp();
  const fetchedAt = nowText();
  const stem = String(fileStem || "").trim() || `weibo_hot_${batchId}`;
  const csvPath = path.join(dataDir, `${stem}.csv`);
  const xlsxPath = path.join(dataDir, `${stem}.xlsx`);
  const timings = {};
  const t0 = Date.now();

  log.info("=".repeat(60));
  log.info(`批次ID: ${batchId}`);
  log.info(`输出CSV: ${path.basename(csvPath)}`);
  log.info(`输出XLSX: ${path.basename(xlsxPath)}`);
  log.info(`登录态文件: ${WEIBO_AUTH_PATH}`);
  log.info("=".repeat(60));

  let t = Date.now();
  if (!authFileLooksValid()) {
    throw new Error(`登录态无效或不存在: ${WEIBO_AUTH_PATH}，请先执行微博登录`);
  }
  timings["登录校验"] = (Date.now() - t) / 1000;
  log.info(`[1/5] 登录态文件校验通过（${fmtSec(timings["登录校验"])}）...`);

  log.info("[2/5] 抓取完整热搜榜...");
  t = Date.now();
  const raw = await fetchHotSearch();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, `${stem}_raw.json`),
    JSON.stringify({ ok: 1, data: raw, batch_id: batchId }, null, 2),
    "utf8"
  );

  let pinnedHeat = null;
  const hotgov = raw.hotgov || {};
  const pinnedWord = String(hotgov.word || hotgov.note || "").trim();
  if (pinnedWord && (hotgov.num == null || hotgov.num === "")) {
    pinnedHeat = await fetchTopicReadCount(pinnedWord);
  }

  let hotRows = normalizeRows(raw, realtimeLimit, fetchedAt, pinnedHeat);
  if (!hotRows.length) throw new Error("热搜榜为空");
  hotRows = hotRows.map((r) => ({ ...r, 批次ID: batchId }));
  saveCsv(hotRows, csvPath, [...HOT_HEADERS]);
  timings["热搜榜"] = (Date.now() - t) / 1000;
  log.info(`  热搜榜 ${hotRows.length} 条 -> ${path.basename(csvPath)}（${fmtSec(timings["热搜榜"])}）`);

  let topics = hotRows.filter((r) => String(r["排名"]) !== "置顶");
  const skippedPinned = hotRows.length - topics.length;
  if (skippedPinned) log.info(`  详情忽略置顶热搜 ${skippedPinned} 条`);
  if (maxTopics > 0) {
    topics = topics.slice(0, maxTopics);
    log.info(`  调试模式: 只抓前 ${topics.length} 个话题详情`);
  }

  log.info(
    `[3/5] 抓取全部话题详情（共 ${topics.length} 个，每话题热门前 ${hotLimit} 条，引擎=http）...`
  );
  t = Date.now();
  const detailRows = await fetchAllTopicsDetailHttp({
    topics,
    hotLimit,
    fetchedAt,
    workers,
    delaySec,
    onLog,
  });
  const detailWithBatch = detailRows.map((r) => ({ ...r, 批次ID: batchId }));
  timings["详情"] = (Date.now() - t) / 1000;
  log.info(`  详情合计 ${detailWithBatch.length} 条（${fmtSec(timings["详情"])}）`);

  let commentRows = [];
  if (!skipCommentZone) {
    log.info(
      `[4/5] 评论区详情：每话题点赞 Top${commentPosts} 帖 × 评论点赞 Top${commentTop}...`
    );
    t = Date.now();
    commentRows = await collectCommentZone({
      detailRows: detailWithBatch,
      postsPerTopic: commentPosts,
      commentTop,
      fetchedAt,
      workers,
      delaySec,
      onLog,
    });
    timings["评论区详情"] = (Date.now() - t) / 1000;
    log.info(`  评论区详情 ${commentRows.length} 行（${fmtSec(timings["评论区详情"])}）`);
  } else {
    log.info("[4/5] 已跳过评论区");
  }

  log.info("[5/5] 导出 Excel（热搜榜单 + 热点详情 + 热点评论）...");
  t = Date.now();
  await exportWorkbook({
    hotRows,
    detailRows: detailWithBatch,
    commentZoneRows: commentRows,
    outPath: xlsxPath,
    batchId,
  });
  timings["导出Excel"] = (Date.now() - t) / 1000;
  timings["总计"] = (Date.now() - t0) / 1000;

  log.info("=".repeat(60));
  log.info("完成");
  log.info(csvPath);
  log.info(xlsxPath);
  log.info("耗时明细:");
  for (const [k, v] of Object.entries(timings)) log.info(`  - ${k}: ${fmtSec(v)}`);
  log.info("=".repeat(60));

  return {
    ok: true,
    batchId,
    csvPath,
    xlsxPath,
    hotCount: hotRows.length,
    detailCount: detailWithBatch.length,
    commentCount: commentRows.length,
    timings,
  };
}

module.exports = { runDaily };
