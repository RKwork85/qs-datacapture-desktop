const fs = require("fs");
const path = require("path");
const { DEFAULT_UA } = require("../browser");
const { WEIBO_DATA_DIR, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const { cookiesFromAuth } = require("./auth");

const API_URL = "https://weibo.com/ajax/side/hotSearch";
const SEARCH_URL = "https://s.weibo.com/weibo?q={query}";
const FIELDNAMES = ["排名", "热搜词", "热度", "标签", "类别", "链接", "采集时间"];

function searchLink(word) {
  const query = encodeURIComponent(`#${String(word).replace(/^#|#$/g, "")}#`);
  return SEARCH_URL.replace("{query}", query);
}

function labelOf(item) {
  return item.label_name || item.icon_desc || item.small_icon_desc || "";
}

function parseCountText(text) {
  text = String(text || "")
    .trim()
    .replace(/,/g, "");
  if (!text) return null;
  if (text.endsWith("万")) {
    const n = Number(text.slice(0, -1));
    return Number.isFinite(n) ? Math.round(n * 10000) : null;
  }
  if (text.endsWith("亿")) {
    const n = Number(text.slice(0, -1));
    return Number.isFinite(n) ? Math.round(n * 100000000) : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function fetchHotSearch() {
  const resp = await fetch(API_URL, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Referer: "https://weibo.com/",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!resp.ok) throw new Error(`请求失败 HTTP ${resp.status}`);
  const payload = await resp.json();
  if (!payload.ok) throw new Error(`接口返回异常: ${JSON.stringify(payload)}`);
  return payload.data;
}

async function fetchTopicReadCount(word, cookie = "") {
  cookie = cookie || cookiesFromAuth();
  if (!cookie) return null;
  const url = searchLink(word);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Cookie: cookie,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await resp.text();
    const m = html.match(/阅读量\s*([0-9.]+万?|[0-9.]+亿?)/);
    if (!m) return null;
    return parseCountText(m[1]);
  } catch {
    return null;
  }
}

function normalizeRows(data, limit, fetchedAt, pinnedHeat = null) {
  const rows = [];
  const hotgov = data.hotgov || {};
  if (hotgov.word || hotgov.note) {
    const word = String(hotgov.word || hotgov.note || "").trim();
    let heat = hotgov.num;
    if (heat == null || heat === "") heat = pinnedHeat != null ? pinnedHeat : "";
    rows.push({
      排名: "置顶",
      热搜词: word,
      热度: heat,
      标签: labelOf(hotgov),
      类别: "政务",
      链接: searchLink(word),
      采集时间: fetchedAt,
    });
  }

  let count = 0;
  for (const item of data.realtime || []) {
    if (item.is_ad) continue;
    const word = String(item.word || item.note || "").trim();
    if (!word) continue;
    count += 1;
    let rank = item.realpos != null ? item.realpos : item.rank;
    if (rank == null) rank = count;
    rows.push({
      排名: rank,
      热搜词: word,
      热度: item.num != null ? item.num : "",
      标签: labelOf(item),
      类别: item.flag_desc || "实时热点",
      链接: searchLink(word),
      采集时间: fetchedAt,
    });
    if (count >= limit) break;
  }
  return rows;
}

function saveCsv(rows, filePath, fields = FIELDNAMES) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [fields.join(",")];
  for (const row of rows) {
    lines.push(
      fields
        .map((k) => {
          const v = String(row[k] ?? "");
          if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
          return v;
        })
        .join(",")
    );
  }
  fs.writeFileSync(filePath, "\ufeff" + lines.join("\n"), "utf8");
  return filePath;
}

async function fetchHotSearchToCsv({
  limit = 50,
  dataDir = WEIBO_DATA_DIR,
  onLog,
  fileStem = "",
} = {}) {
  const log = createLogger(onLog);
  log.info("正在抓取微博热搜...");
  const data = await fetchHotSearch();
  const fetchedAt = nowText();
  let pinnedHeat = null;
  const hotgov = data.hotgov || {};
  const pinnedWord = String(hotgov.word || hotgov.note || "").trim();
  if (pinnedWord && (hotgov.num == null || hotgov.num === "")) {
    log.info("置顶无接口热度，尝试用话题阅读量补全...");
    pinnedHeat = await fetchTopicReadCount(pinnedWord);
  }
  const rows = normalizeRows(data, limit, fetchedAt, pinnedHeat);
  if (!rows.length) throw new Error("未解析到热搜数据");
  const stem = String(fileStem || "").trim() || `weibo_hot_${stamp()}`;
  const outPath = path.join(dataDir, `${stem}.csv`);
  saveCsv(rows, outPath);
  log.info(`共 ${rows.length} 条 -> ${outPath}`);
  return { ok: true, rows, csvPath: outPath, raw: data, fileStem: stem };
}

module.exports = {
  API_URL,
  SEARCH_URL,
  FIELDNAMES,
  searchLink,
  fetchHotSearch,
  fetchTopicReadCount,
  normalizeRows,
  saveCsv,
  fetchHotSearchToCsv,
};
