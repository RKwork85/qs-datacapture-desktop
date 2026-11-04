const { DEFAULT_UA } = require("../browser");
const { createLogger } = require("../logger");
const { authFileLooksValid, cookiesFromAuth, WEIBO_AUTH_PATH } = require("./auth");
const { searchLink, SEARCH_URL } = require("./hot-search");

function stripTags(s) {
  s = String(s || "").replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseActCount(text) {
  text = String(text || "").trim();
  if (!text || ["转发", "评论", "赞", "点赞"].includes(text)) return "0";
  const mWan = text.match(/([\d.]+)\s*万/);
  if (mWan) return String(Math.round(parseFloat(mWan[1]) * 10000));
  const m = text.replace(/,/g, "").match(/\d+/);
  return m ? m[0] : "0";
}

function parseActs(actNums) {
  const vals = [...(actNums || [])];
  while (vals.length < 3) vals.push("0");
  return [parseActCount(vals[0]), parseActCount(vals[1]), parseActCount(vals[2])];
}

function cardsToRows(cards, topicWord, fetchedAt) {
  const rows = [];
  const counters = { 置顶: 0, 热门: 0 };
  for (const card of cards) {
    const source = card._source || "热门";
    counters[source] = (counters[source] || 0) + 1;
    const [repost, comment, like] = parseActs(card.actNums || []);
    rows.push({
      热搜词: topicWord,
      来源类型: source,
      序号: counters[source],
      作者: card.author || "",
      正文: card.content || "",
      发布时间: card.fromText || "",
      转发: repost,
      评论: comment,
      点赞: like,
      微博链接: card.postUrl || "",
      mid: card.mid || "",
      采集时间: fetchedAt,
    });
  }
  return rows;
}

async function fetchSearchHtml(url, cookie, { timeoutMs = 30000, retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": DEFAULT_UA,
            Cookie: cookie,
            Referer: "https://s.weibo.com/",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            Connection: "close",
          },
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          if ([418, 403, 429, 503].includes(resp.status) && attempt < retries) {
            await sleep(1500 * attempt + 1000);
            continue;
          }
          throw new Error(`HTTP ${resp.status} ${url}`);
        }
        return await resp.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`请求失败 ${e.message || e} ${url}`);
    }
  }
  throw new Error(`请求失败 ${lastErr} ${url}`);
}

function looksLikeLoginWall(html) {
  if (!html) return true;
  if (html.includes("Sina Visitor System")) return true;
  if (html.includes("passport.weibo.com") && !html.includes("card-wrap")) return true;
  if ((html.match(/mid="/g) || []).length < 1) {
    const head = html.slice(0, 2000);
    if (head.includes("登录") || head.includes("扫码")) return true;
  }
  return false;
}

function parseFeedCards(html) {
  const starts = [];
  const re = /<div class="card-wrap"[^>]*\bmid="/g;
  let m;
  while ((m = re.exec(html))) starts.push(m.index);
  const rows = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    const part = html.slice(start, end);
    const mm = part.match(/\bmid="(\d+)"/);
    if (!mm) continue;
    const mid = mm[1];
    let top = "";
    const topM = part.match(
      /class="card-top"[^>]*>[\s\S]*?<(?:a|span|h4|div)[^>]*>\s*([^<]+)\s*</
    );
    if (topM) top = topM[1].trim();
    if (!top) {
      const head = part.slice(0, 1200);
      if (/>\s*置顶\s*</.test(head)) top = "置顶";
      else if (/>\s*热门\s*</.test(head)) top = "热门";
    }
    let am = part.match(/class="name"[^>]*>([^<]+)</);
    if (!am) am = part.match(/nick-name="([^"]+)"/);
    const author = am ? stripTags(am[1]) : "";
    let txt = "";
    const tm = part.match(/<p class="txt"[^>]*>(.*?)<\/p>/s);
    if (tm) txt = stripTags(tm[1]).replace(/\s*展开c?\s*$/, "").trim();
    let fromText = "";
    let postUrl = "";
    const cu = part.match(/copyurl\('(https?:\/\/weibo\.com\/[^']+)'\)/);
    if (cu) postUrl = cu[1].split("?")[0];
    const fm = part.match(/<div class="from"[^>]*>(.*?)<\/div>/s);
    if (fm) {
      fromText = stripTags(fm[1]).replace(/\s+/g, " ");
      if (!postUrl) {
        const um = fm[1].match(/href="(\/\/weibo\.com\/[^"]+|https?:\/\/weibo\.com\/[^"]+)"/);
        if (um) {
          let href = um[1];
          if (href.startsWith("//")) href = "https:" + href;
          postUrl = href.split("?")[0];
        }
      }
    }
    const actNums = [];
    const actBlock = part.match(/class="card-act"[^>]*>(.*?)<\/ul>/s);
    if (actBlock) {
      const rawActs = [...actBlock[1].matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((x) =>
        stripTags(x[1]).replace(/\s+/g, " ").trim()
      );
      const cleaned = rawActs.filter((a) => a && !["收藏", "帮上头条", "投诉"].includes(a));
      actNums.push(...(cleaned.length >= 3 ? cleaned.slice(-3) : cleaned));
    }
    if (!author && !txt) continue;
    rows.push({ mid, author, content: txt, fromText, postUrl, actNums, topText: top });
  }
  return rows;
}

function collectHotCards(cards, { hotLimit, pinnedMids = new Set(), seen = new Set() }) {
  const hot = [];
  pinnedMids = new Set(pinnedMids);
  seen = new Set(seen);
  for (const card of cards) {
    const mid = card.mid || "";
    if (mid && pinnedMids.has(mid)) continue;
    if ((card.topText || "").includes("置顶")) {
      if (mid) pinnedMids.add(mid);
      continue;
    }
    if (mid && seen.has(mid)) continue;
    const item = { ...card, _source: "热门" };
    hot.push(item);
    if (mid) seen.add(mid);
    if (hot.length >= hotLimit) break;
  }
  return { hot, seen, pinnedMids };
}

async function fetchTopicDetailHttp(topic, cookie, hotLimit, fetchedAt) {
  const word = topic["热搜词"] || "";
  let mainUrl = topic["链接"] || searchLink(word);
  mainUrl = mainUrl.replace(/[&?]xsort=[^&]*/g, "").replace(/[&?]Refer=[^&]*/g, "");
  const sep = mainUrl.includes("?") ? "&" : "?";
  const hotUrl = `${mainUrl}${sep}xsort=hot&Refer=hotmore`;

  const htmlHot = await fetchSearchHtml(hotUrl, cookie);
  if (looksLikeLoginWall(htmlHot)) {
    throw new Error("搜索页疑似未登录/访客墙，请重新登录微博");
  }
  const cardsHot = parseFeedCards(htmlHot);
  let pinnedMids = new Set(
    cardsHot.filter((c) => (c.topText || "").includes("置顶") && c.mid).map((c) => c.mid)
  );
  let { hot, seen } = collectHotCards(cardsHot, { hotLimit, pinnedMids });

  if (hot.length < hotLimit) {
    const htmlMain = await fetchSearchHtml(mainUrl, cookie);
    if (looksLikeLoginWall(htmlMain)) {
      throw new Error("搜索页疑似未登录/访客墙，请重新登录微博");
    }
    const cardsMain = parseFeedCards(htmlMain);
    for (const c of cardsMain) {
      if ((c.topText || "").includes("置顶") && c.mid) pinnedMids.add(c.mid);
    }
    const more = collectHotCards(cardsMain, {
      hotLimit: hotLimit - hot.length,
      pinnedMids,
      seen,
    }).hot;
    hot = hot.concat(more);
  }
  return cardsToRows(hot.slice(0, hotLimit), word, fetchedAt);
}

async function verifyHttpLogin(cookie, probeUrl = "") {
  if (!cookie || !authFileLooksValid()) return false;
  const url = probeUrl || SEARCH_URL.replace("{query}", encodeURIComponent("#微博#"));
  try {
    const html = await fetchSearchHtml(url, cookie, { retries: 5 });
    if (looksLikeLoginWall(html)) return false;
    return html.includes('mid="') || html.includes("card-wrap");
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("418") || msg.includes("429")) return true;
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function fetchAllTopicsDetailHttp({
  topics,
  hotLimit,
  fetchedAt,
  workers = 2,
  delaySec = 0.4,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!authFileLooksValid()) {
    throw new Error(`登录态无效: ${WEIBO_AUTH_PATH}，请先登录微博`);
  }
  const cookie = cookiesFromAuth();
  if (!cookie) throw new Error("weibo_auth.json 中无 Cookie");
  const probe = (topics[0] && topics[0]["链接"]) || "";
  if (!(await verifyHttpLogin(cookie, probe))) {
    throw new Error("HTTP 登录校验失败，请重新登录微博");
  }

  const total = topics.length;
  log.info(
    `HTTP 模式抓取详情：${total} 个话题，并发=${workers}，间隔≈${delaySec}s，每话题热门前 ${hotLimit}`
  );

  const results = await mapPool(topics, workers, async (topic, i) => {
    await sleep(delaySec * 1000 * (i % Math.max(workers, 1)));
    try {
      const rows = await fetchTopicDetailHttp(topic, cookie, hotLimit, fetchedAt);
      return { rows, err: "" };
    } catch (e) {
      return { rows: [], err: String(e.message || e) };
    }
  });

  let fail = 0;
  results.forEach((r, i) => {
    const topic = topics[i];
    if (r.err) {
      fail += 1;
      log.warn(`[${i + 1}/${total}] 失败 [${topic["排名"]}] ${topic["热搜词"]}: ${r.err}`);
    } else {
      log.info(
        `[${i + 1}/${total}] OK [${topic["排名"]}] ${topic["热搜词"]} -> ${r.rows.length} 条`
      );
    }
  });

  const failedIdx = results.map((r, i) => (!r.rows.length ? i : -1)).filter((i) => i >= 0);
  if (failedIdx.length) {
    log.info(`对 ${failedIdx.length} 个失败话题串行补抓...`);
    await sleep(3000);
    for (const idx of failedIdx) {
      const topic = topics[idx];
      try {
        await sleep(Math.max(delaySec, 0.8) * 1000);
        const rows = await fetchTopicDetailHttp(topic, cookie, hotLimit, fetchedAt);
        results[idx] = { rows, err: "" };
        fail = Math.max(0, fail - 1);
        log.info(`  补抓 OK [${topic["排名"]}] ${topic["热搜词"]} -> ${rows.length} 条`);
      } catch (e) {
        log.warn(`  补抓失败 [${topic["排名"]}] ${topic["热搜词"]}: ${e.message || e}`);
      }
    }
  }

  const allRows = [];
  for (const r of results) allRows.push(...(r.rows || []));
  const ok = results.filter((r) => r.rows && r.rows.length).length;
  log.info(`HTTP 详情完成：成功话题 ${ok}/${total}，微博行 ${allRows.length}`);
  return allRows;
}

module.exports = {
  fetchAllTopicsDetailHttp,
  fetchTopicDetailHttp,
  cardsToRows,
  parseFeedCards,
};
