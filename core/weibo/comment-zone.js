const { DEFAULT_UA } = require("../browser");
const { createLogger } = require("../logger");
const { authFileLooksValid, cookiesFromAuth, WEIBO_AUTH_PATH } = require("./auth");

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

function stripHtml(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function toInt(v, def = 0) {
  try {
    let s = String(v).trim().replace(/,/g, "");
    if (!s) return def;
    if (s.endsWith("万")) return Math.round(parseFloat(s.slice(0, -1)) * 10000);
    return Math.round(parseFloat(s));
  } catch {
    return def;
  }
}

function likeOf(c) {
  for (const key of ["like_counts", "like_count", "liked_count"]) {
    if (c[key] != null) return toInt(c[key], 0);
  }
  return 0;
}

function formatCommentTime(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, cookie, referer, { mobile = false, retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const headers = {
        "User-Agent": mobile ? UA_MOBILE : DEFAULT_UA,
        Cookie: cookie,
        Referer: referer,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      };
      if (mobile) headers["MWeibo-Pwa"] = "1";
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        if ([418, 403, 429, 503].includes(resp.status) && attempt < retries) {
          await sleep(1500 * attempt + 1000);
          continue;
        }
        throw new Error(`HTTP ${resp.status} ${url}`);
      }
      return await resp.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`请求失败 ${e.message || e}`);
    }
  }
  throw new Error(`请求失败 ${lastErr}`);
}

function mblogidFromUrl(url) {
  const m = String(url || "").match(/weibo\.com\/\d+\/([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}

async function ensureMid(post, cookie) {
  const item = { ...post };
  const mid = String(item.mid || "").trim();
  if (/^\d{10,}$/.test(mid)) return item;
  const key = mblogidFromUrl(String(item["微博链接"] || "")) || mid;
  if (!key) return item;
  const referer = String(item["微博链接"] || "https://weibo.com/");
  try {
    const show = await httpJson(
      `https://weibo.com/ajax/statuses/show?id=${key}`,
      cookie,
      referer
    );
    if (show.ok === -100) throw new Error("登录失效");
    item.mid = String(show.id || show.mid || mid);
    const user = show.user || {};
    if (user.id != null) item.uid = String(user.id);
    if (user.screen_name) item["作者"] = user.screen_name;
    if (show.attitudes_count != null) item["点赞"] = show.attitudes_count;
    if (show.comments_count != null) item["评论"] = show.comments_count;
    if (show.reposts_count != null) item["转发"] = show.reposts_count;
  } catch (_) {
    /* ignore */
  }
  return item;
}

function hasValidMid(post) {
  const mid = String(post.mid || "").trim();
  return /^\d{10,}$/.test(mid);
}

function pickTopPostsByLikes(detailRows, postsPerTopic = 3) {
  const byTopic = {};
  for (const row of detailRows) {
    if (toInt(row["评论"], 0) <= 0) continue;
    const word = String(row["热搜词"] || "");
    byTopic[word] = byTopic[word] || [];
    byTopic[word].push(row);
  }
  const selected = [];
  for (const [, rows] of Object.entries(byTopic)) {
    const ranked = [...rows].sort((a, b) => toInt(b["点赞"], 0) - toInt(a["点赞"], 0));
    const seen = new Set();
    let kept = 0;
    for (const r of ranked) {
      const mid = String(r.mid || "");
      const link = String(r["微博链接"] || "");
      const key = mid || link;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push({ ...r, _评论区序: kept + 1 });
      kept += 1;
      if (kept >= postsPerTopic) break;
    }
  }
  return selected;
}

async function fetchHotComments(mid, cookie, { commentTop = 100, delaySec = 0.2 } = {}) {
  if (!mid) return [];
  const collected = [];
  const seen = new Set();
  const add = (batch) => {
    let added = 0;
    for (const c of batch) {
      const cid = String(c.id || c.idstr || "");
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      collected.push(c);
      added += 1;
    }
    return added;
  };

  let maxId = 0;
  let maxIdType = 0;
  const maxPages = Math.max(1, Math.ceil(commentTop / 20)) + 2;
  for (let page = 0; page < maxPages; page += 1) {
    const url = `https://m.weibo.cn/comments/hotflow?id=${mid}&mid=${mid}&max_id=${maxId}&max_id_type=${maxIdType}`;
    try {
      const payload = await httpJson(url, cookie, `https://m.weibo.cn/detail/${mid}`, {
        mobile: true,
      });
      if (payload.ok !== 1) break;
      const data = payload.data || {};
      const batch = data.data || [];
      if (!Array.isArray(batch) || !batch.length) break;
      add(batch);
      if (collected.length >= commentTop) break;
      const nxt = data.max_id;
      const nxtType = data.max_id_type || 0;
      if (nxt == null || nxt === "" || nxt === 0 || nxt === "0" || nxt === maxId) break;
      maxId = nxt;
      maxIdType = nxtType;
      if (page + 1 < maxPages) await sleep(delaySec * 1000);
    } catch {
      break;
    }
  }

  if (collected.length < commentTop) {
    let deskMax = 0;
    const remainPages = Math.max(1, Math.ceil((commentTop - collected.length) / 20)) + 1;
    for (let page = 0; page < remainPages; page += 1) {
      const url =
        "https://weibo.com/ajax/statuses/buildComments" +
        `?is_reload=1&id=${mid}&is_show_bulletin=2&is_mix=0&count=20&type=feed&flow=0&max_id=${deskMax}`;
      try {
        const payload = await httpJson(url, cookie, "https://weibo.com/");
        if (payload.ok !== 1) break;
        const batch = payload.data || [];
        if (!Array.isArray(batch) || !batch.length) break;
        add(batch);
        if (collected.length >= commentTop) break;
        let nxt = Number(payload.max_id || 0);
        if (!nxt || nxt === deskMax) break;
        deskMax = nxt;
        if (page + 1 < remainPages) await sleep(delaySec * 1000);
      } catch {
        break;
      }
    }
  }

  return [...collected].sort((a, b) => likeOf(b) - likeOf(a)).slice(0, commentTop);
}

function commentZoneRow(post, c, { zoneSeq, commentSeq, fetchedAt }) {
  return {
    批次ID: post["批次ID"] || "",
    热搜词: post["热搜词"] || "",
    微博链接: post["微博链接"] || "",
    mid: post.mid || "",
    微博作者: post["作者"] || "",
    帖子点赞: post["点赞"] || "",
    评论区序: zoneSeq,
    评论序: commentSeq,
    评论ID: String(c.id || c.idstr || ""),
    评论用户: (c.user || {}).screen_name || "",
    评论内容: stripHtml(String(c.text_raw || c.text || "")),
    评论点赞: likeOf(c),
    评论时间: formatCommentTime(c.created_at),
    采集时间: fetchedAt,
  };
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => run()));
  return results;
}

async function collectCommentZone({
  detailRows,
  postsPerTopic = 3,
  commentTop = 100,
  fetchedAt = "",
  workers = 2,
  delaySec = 0.4,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!authFileLooksValid()) throw new Error(`登录态无效: ${WEIBO_AUTH_PATH}`);
  const cookie = cookiesFromAuth();
  if (!cookie) throw new Error("weibo_auth.json 无 Cookie");

  let selected = pickTopPostsByLikes(detailRows, postsPerTopic);
  log.info(
    `评论区：每话题点赞 Top${postsPerTopic} 帖，共选中 ${selected.length} 条；每帖评论点赞 Top${commentTop}`
  );
  if (!selected.length) return [];

  const needFix = selected.map((p, i) => (!hasValidMid(p) ? i : -1)).filter((i) => i >= 0);
  if (needFix.length) {
    log.info(`  补全 mid：${needFix.length}/${selected.length} 条`);
    await Promise.all(
      needFix.map(async (i) => {
        selected[i] = await ensureMid(selected[i], cookie);
      })
    );
  } else {
    log.info("  mid 均已就绪，跳过 show 补全");
  }

  const pageDelay = Math.min(delaySec, 0.2);
  const total = selected.length;
  const results = await mapPool(selected, workers, async (post, idx) => {
    await sleep(50 * (idx % Math.max(workers, 1)));
    const mid = String(post.mid || "");
    const zoneSeq = Number(post._评论区序 || 0);
    if (!mid) return { rows: [], err: "无 mid" };
    try {
      const comments = await fetchHotComments(mid, cookie, {
        commentTop,
        delaySec: pageDelay,
      });
      const rows = comments.map((c, i) =>
        commentZoneRow(post, c, { zoneSeq, commentSeq: i + 1, fetchedAt })
      );
      return { rows, err: "" };
    } catch (e) {
      return { rows: [], err: String(e.message || e) };
    }
  });

  const out = [];
  results.forEach((r, i) => {
    const post = selected[i];
    if (r.err) log.warn(`[${i + 1}/${total}] 失败 [${post["热搜词"]}] mid=${post.mid}: ${r.err}`);
    else {
      log.info(
        `[${i + 1}/${total}] OK [${post["热搜词"]}] mid=${post.mid} 评论=${r.rows.length}`
      );
      out.push(...r.rows);
    }
  });
  log.info(`评论区完成：${out.length} 行`);
  return out;
}

module.exports = { collectCommentZone, pickTopPostsByLikes };
