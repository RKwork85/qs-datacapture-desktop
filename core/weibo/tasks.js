const fs = require("fs");
const path = require("path");
const { WEIBO_DATA_DIR, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const { authFileLooksValid, WEIBO_AUTH_PATH } = require("./auth");
const { saveCsv, FIELDNAMES } = require("./hot-search");
const { fetchAllTopicsDetailHttp } = require("./detail-http");
const { collectCommentZone } = require("./comment-zone");
const {
  exportWorkbook,
  HOT_HEADERS,
  DETAIL_HEADERS,
  COMMENT_ZONE_HEADERS,
} = require("./export-excel");

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function latestHotCsv(dataDir = WEIBO_DATA_DIR) {
  if (!fs.existsSync(dataDir)) return "";
  const files = fs
    .readdirSync(dataDir)
    .filter((n) => /^weibo_hot_\d{8}_\d{6}\.csv$/i.test(n))
    .map((n) => path.join(dataDir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

function latestDetailCsv(dataDir = WEIBO_DATA_DIR) {
  if (!fs.existsSync(dataDir)) return "";
  const files = fs
    .readdirSync(dataDir)
    .filter((n) => /^weibo_detail_.*\.csv$/i.test(n))
    .map((n) => path.join(dataDir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

function listWeiboDataFiles(dataDir = WEIBO_DATA_DIR) {
  if (!fs.existsSync(dataDir)) return { hot: [], detail: [], comment: [], xlsx: [] };
  const names = fs.readdirSync(dataDir);
  const map = (re) =>
    names
      .filter((n) => re.test(n))
      .map((n) => {
        const full = path.join(dataDir, n);
        return { name: n, path: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  return {
    hot: map(/^weibo_hot_\d{8}_\d{6}\.csv$/i),
    detail: map(/^weibo_detail_.*\.csv$/i),
    comment: map(/^weibo_comment_.*\.csv$/i),
    xlsx: map(/^weibo_.*\.xlsx$/i),
  };
}

async function fetchDetailFromHotCsv({
  csvPath = "",
  hotLimit = 10,
  maxTopics = 0,
  delaySec = 0.4,
  workers = 2,
  dataDir = WEIBO_DATA_DIR,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!authFileLooksValid()) {
    throw new Error(`登录态无效: ${WEIBO_AUTH_PATH}，请先登录微博`);
  }
  const src = csvPath || latestHotCsv(dataDir);
  if (!src || !fs.existsSync(src)) {
    throw new Error("未找到热搜 CSV，请先在「热搜榜」采集");
  }
  log.info(`读取热搜榜: ${src}`);
  let topics = parseCsv(src).filter((r) => String(r["排名"]) !== "置顶");
  if (!topics.length) throw new Error("热搜 CSV 无可用话题（已排除置顶）");
  if (maxTopics > 0) topics = topics.slice(0, maxTopics);
  const fetchedAt = nowText();
  const batchId = stamp();
  const detailRows = await fetchAllTopicsDetailHttp({
    topics,
    hotLimit,
    fetchedAt,
    workers,
    delaySec,
    onLog,
  });
  const withBatch = detailRows.map((r) => ({ ...r, 批次ID: batchId }));
  const outCsv = path.join(dataDir, `weibo_detail_${batchId}.csv`);
  saveCsv(withBatch, outCsv, DETAIL_HEADERS);
  const hotRows = parseCsv(src).map((r) => ({ ...r, 批次ID: batchId }));
  const xlsxPath = path.join(dataDir, `weibo_detail_${batchId}.xlsx`);
  await exportWorkbook({
    hotRows,
    detailRows: withBatch,
    commentZoneRows: [],
    outPath: xlsxPath,
    batchId,
  });
  log.info(`详情 ${withBatch.length} 条 -> ${outCsv}`);
  return {
    ok: true,
    batchId,
    sourceCsv: src,
    csvPath: outCsv,
    xlsxPath,
    count: withBatch.length,
    topicCount: topics.length,
  };
}

async function fetchCommentsFromDetailCsv({
  csvPath = "",
  commentPosts = 3,
  commentTop = 100,
  delaySec = 0.4,
  workers = 2,
  dataDir = WEIBO_DATA_DIR,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!authFileLooksValid()) {
    throw new Error(`登录态无效: ${WEIBO_AUTH_PATH}，请先登录微博`);
  }
  const src = csvPath || latestDetailCsv(dataDir);
  if (!src || !fs.existsSync(src)) {
    throw new Error("未找到详情 CSV，请先在「榜单详情」采集");
  }
  log.info(`读取详情: ${src}`);
  const detailRows = parseCsv(src);
  if (!detailRows.length) throw new Error("详情 CSV 为空");
  const fetchedAt = nowText();
  const batchId = stamp();
  const commentRows = await collectCommentZone({
    detailRows,
    postsPerTopic: commentPosts,
    commentTop,
    fetchedAt,
    workers,
    delaySec,
    onLog,
  });
  const withBatch = commentRows.map((r) => ({ ...r, 批次ID: batchId }));
  const outCsv = path.join(dataDir, `weibo_comment_${batchId}.csv`);
  saveCsv(withBatch, outCsv, COMMENT_ZONE_HEADERS);
  const xlsxPath = path.join(dataDir, `weibo_comment_${batchId}.xlsx`);
  await exportWorkbook({
    hotRows: [],
    detailRows: detailRows.map((r) => ({ ...r, 批次ID: r["批次ID"] || batchId })),
    commentZoneRows: withBatch,
    outPath: xlsxPath,
    batchId,
  });
  log.info(`评论区 ${withBatch.length} 行 -> ${outCsv}`);
  return {
    ok: true,
    batchId,
    sourceCsv: src,
    csvPath: outCsv,
    xlsxPath,
    count: withBatch.length,
  };
}

module.exports = {
  parseCsv,
  latestHotCsv,
  latestDetailCsv,
  listWeiboDataFiles,
  fetchDetailFromHotCsv,
  fetchCommentsFromDetailCsv,
  FIELDNAMES,
};
