function emit(onLog, level, message) {
  if (typeof onLog === "function") onLog({ level, message });
}

function getXhs() {
  return require("../core/xhs");
}
function getDy() {
  return require("../core/dy");
}
function getWeibo() {
  return require("../core/weibo");
}

function looksLikeXhsProfile(url) {
  const u = String(url || "");
  // 主页：/user/profile/{uid}；带笔记 id 的算单条，不走主页采集
  if (!/xiaohongshu\.com\/user\/profile\//i.test(u)) return false;
  return !/xiaohongshu\.com\/user\/profile\/[^/?#]+\/[0-9a-f]+/i.test(u);
}

function looksLikeDyProfile(url) {
  return /douyin\.com\/user\//i.test(url);
}

function resolveLimit(params = {}, fallback = 20) {
  const n = Number(params.maxNotes ?? params.limit ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(150, Math.floor(n));
}

async function runXhsCrawlBatch(params = {}, onLog) {
  const xhs = getXhs();
  const urls = Array.isArray(params.urls) ? params.urls.map((u) => String(u || "").trim()).filter(Boolean) : [];
  const maxNotes = resolveLimit(params, 20);
  const results = [];
  const profileUrls = [];
  const noteUrls = [];
  const otherUrls = [];
  for (const url of urls) {
    if (looksLikeXhsProfile(url)) profileUrls.push(url);
    else if (xhs.looksLikeNoteUrl?.(url) || /xiaohongshu\.com|xhslink\.com/i.test(url)) noteUrls.push(url);
    else otherUrls.push(url);
  }
  for (const url of profileUrls) {
    emit(onLog, "info", `[crawl_batch] 小红书主页采集: ${url} · 条数 ${maxNotes}`);
    results.push({
      url,
      kind: "profile",
      result: await xhs.fetchProfileNotes({ onLog, profileUrl: url, maxNotes }),
    });
  }
  if (noteUrls.length) {
    emit(onLog, "info", `[crawl_batch] 小红书笔记直采 ${noteUrls.length} 条`);
    results.push({
      kind: "note_batch",
      urls: noteUrls,
      result: await xhs.fetchNotesByUrls({ onLog, urls: noteUrls, maxNotes: noteUrls.length }),
    });
  }
  for (const url of otherUrls) {
    emit(onLog, "warn", `[crawl_batch] 无法识别的小红书链接，已跳过: ${url}`);
    results.push({ url, kind: "unknown", skipped: true });
  }
  return { platform: "xhs", urls, maxNotes, results };
}

async function runDyCrawlBatch(params = {}, onLog) {
  const dy = getDy();
  const urls = Array.isArray(params.urls) ? params.urls.map((u) => String(u || "").trim()).filter(Boolean) : [];
  const maxNotes = resolveLimit(params, 20);
  const results = [];
  const profileUrls = [];
  const videoUrls = [];
  const otherUrls = [];
  for (const url of urls) {
    if (looksLikeDyProfile(url)) profileUrls.push(url);
    else if (dy.looksLikeVideoUrl?.(url) || /douyin\.com\/(?:video|note)\//i.test(url)) videoUrls.push(url);
    else otherUrls.push(url);
  }
  for (const url of profileUrls) {
    emit(onLog, "info", `[crawl_batch] 抖音主页采集: ${url} · 条数 ${maxNotes}`);
    results.push({
      url,
      kind: "profile",
      result: await dy.fetchProfileNotes({ onLog, profileUrl: url, maxNotes }),
    });
  }
  if (videoUrls.length) {
    emit(onLog, "info", `[crawl_batch] 抖音作品直采 ${videoUrls.length} 条`);
    results.push({
      kind: "video_batch",
      urls: videoUrls,
      result: await dy.fetchAwemeByUrls({ onLog, urls: videoUrls, download: true }),
    });
  }
  for (const url of otherUrls) {
    emit(onLog, "warn", `[crawl_batch] 无法识别的抖音链接，已跳过: ${url}`);
    results.push({ url, kind: "unknown", skipped: true });
  }
  return { platform: "dy", urls, maxNotes, results };
}

async function runWeiboCrawlBatch(params = {}, onLog) {
  const urls = Array.isArray(params.urls) ? params.urls.map((u) => String(u || "").trim()).filter(Boolean) : [];
  const results = [];
  for (const url of urls) {
    emit(onLog, "warn", `[crawl_batch] 微博链接直采尚未接入，已登记: ${url}`);
    results.push({ url, kind: "link", skipped: true, reason: "weibo_url_pending" });
  }
  return { platform: "weibo", urls, results };
}

async function runCrawlSearch(platform, params = {}, onLog) {
  const keywords = Array.isArray(params.keywords)
    ? params.keywords.map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  const limit = resolveLimit(params, 20);
  if (!keywords.length) throw new Error("搜索词为空");
  const results = [];
  if (platform === "weibo") {
    const weibo = getWeibo();
    emit(onLog, "info", `[crawl_search] 微博热搜采集 · 关键词 ${keywords.length} · 条数 ${limit}`);
    results.push({
      kind: "hot",
      keywords,
      result: await weibo.fetchHotSearchToCsv({ onLog, limit }),
    });
  } else if (platform === "dy") {
    const dy = getDy();
    emit(onLog, "info", `[crawl_search] 抖音搜索采集 · ${keywords.join("、")} · 条数 ${limit}`);
    results.push({
      kind: "search",
      keywords,
      result: await dy.fetchSearchNotes({ onLog, keywords, maxNotes: limit }),
    });
  } else if (platform === "xhs") {
    const xhs = getXhs();
    emit(onLog, "info", `[crawl_search] 小红书搜索采集 · ${keywords.join("、")} · 条数 ${limit}`);
    results.push({
      kind: "search",
      keywords,
      result: await xhs.fetchSearchNotes({ onLog, keywords, maxNotes: limit }),
    });
  } else {
    emit(
      onLog,
      "warn",
      `[crawl_search] ${platform} 搜索采集尚未完全接入，已登记关键词 ${keywords.join("、")}（limit=${limit}）`
    );
    results.push({ kind: "search_pending", platform, keywords, limit, skipped: true });
  }
  return { platform, keywords, limit, results };
}

function buildHandlers() {
  const dy = getDy();
  const xhs = getXhs();
  const weibo = getWeibo();
  return {
    "dy.login": (params, onLog) => dy.login({ onLog, ...params }),
    "dy.fetch_profile": (params, onLog) => dy.fetchProfileNotes({ onLog, ...params }),
    "dy.fetch_media": (params, onLog) => dy.fetchNoteMedia({ onLog, ...params }),
    "dy.fetch_aweme": (params, onLog) => dy.fetchAwemeByUrls({ onLog, ...params }),
    "dy.fetch_search": (params, onLog) => dy.fetchSearchNotes({ onLog, ...params }),
    "dy.publish_note": (params, onLog) => dy.publishNote({ onLog, ...params }),
    "dy.publish_video": (params, onLog) => dy.publishVideo({ onLog, ...params }),
    "dy.crawl_batch": (params, onLog) => runDyCrawlBatch(params, onLog),
    "dy.crawl_search": (params, onLog) => runCrawlSearch("dy", params, onLog),
    "xhs.login": (params, onLog) => xhs.login({ onLog, ...params }),
    "xhs.fetch_profile": (params, onLog) => xhs.fetchProfileNotes({ onLog, ...params }),
    "xhs.fetch_media": (params, onLog) => xhs.fetchNoteMedia({ onLog, ...params }),
    "xhs.fetch_note": (params, onLog) => xhs.fetchNotesByUrls({ onLog, ...params }),
    "xhs.fetch_search": (params, onLog) => xhs.fetchSearchNotes({ onLog, ...params }),
    "xhs.publish_note": (params, onLog) => xhs.publishNote({ onLog, ...params }),
    "xhs.publish_video": (params, onLog) => xhs.publishVideo({ onLog, ...params }),
    "xhs.crawl_batch": (params, onLog) => runXhsCrawlBatch(params, onLog),
    "xhs.crawl_search": (params, onLog) => runCrawlSearch("xhs", params, onLog),
    "weibo.login": (params, onLog) => weibo.login({ onLog, ...params }),
    "weibo.hot": (params, onLog) => weibo.fetchHotSearchToCsv({ onLog, ...params }),
    "weibo.detail": (params, onLog) => weibo.fetchDetailFromHotCsv({ onLog, ...params }),
    "weibo.comments": (params, onLog) =>
      weibo.fetchCommentsFromDetailCsv({ onLog, ...params }),
    "weibo.daily": (params, onLog) => weibo.runDaily({ onLog, ...params }),
    "weibo.pipeline": (params, onLog) => weibo.runPipeline({ onLog, ...params }),
    "weibo.crawl_batch": (params, onLog) => runWeiboCrawlBatch(params, onLog),
    "weibo.crawl_search": (params, onLog) => runCrawlSearch("weibo", params, onLog),
  };
}

let cachedHandlers = null;

function getHandlers() {
  if (!cachedHandlers) cachedHandlers = buildHandlers();
  return cachedHandlers;
}

async function runTask(type, params = {}, onLog) {
  const handler = getHandlers()[type];
  if (!handler) throw new Error(`未知任务类型: ${type}`);
  return handler(params || {}, onLog);
}

module.exports = {
  runTask,
  get HANDLERS() {
    return getHandlers();
  },
};
