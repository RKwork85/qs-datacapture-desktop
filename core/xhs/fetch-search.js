const fs = require("fs");
const path = require("path");
const { getChromium } = require("../pw");
const { XHS_DATA_DIR, stamp, nowText } = require("../paths");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const auth = require("./auth");
const {
  emptyNoteRow,
  formatType,
  rowFromProfileCard,
  writeNoteTable,
} = require("./fields");
const { exportCsv, CSV_FIELDS } = require("./fetch-profile");

const SEARCH_API_HINTS = [
  "search/notes",
  "search/bff",
  "/api/sns/web/v1/search",
  "web_search",
  "search/note",
];

const COUNT_KEYS = new Set(["点赞数", "收藏数", "评论数", "转发数"]);

/** 与主页采集同源的 DOM 卡片抽取（搜索页同样有 explore / search_result 链） */
const COLLECT_JS = `(() => {
  const abs = (href) => { try { return new URL(href, location.origin).href; } catch { return href || ""; } };
  const noteIdFromHref = (href) => {
    if (!href) return "";
    try {
      const u = new URL(href, location.origin);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "user" && parts[1] === "profile" && parts.length >= 4) return parts[3];
      if (parts[0] === "discovery" && parts[1] === "item" && parts[2]) return parts[2];
      if (parts[0] === "explore" || parts[0] === "search_result") return parts[1] || "";
      return "";
    } catch { return ""; }
  };
  const linkScore = (href) => {
    try {
      const u = new URL(href, location.origin);
      const hasToken = u.searchParams.has("xsec_token") ? 100 : 0;
      const parts = u.pathname.split("/").filter(Boolean);
      const isProfileNote = parts[0] === "user" && parts[1] === "profile" && parts.length >= 4 ? 20 : 0;
      const isExplore = parts[0] === "explore" || parts[0] === "search_result" ? 5 : 0;
      return hasToken + isProfileNote + isExplore;
    } catch { return 0; }
  };
  const isCoverUrl = (src) => !!src && /xhsstatic|xhscdn|xiaohongshu|ci\\.xiaohongshu/i.test(src) && !/avatar|head|logo/i.test(src);
  const parseLikes = (text) => {
    if (!text) return "";
    const t = String(text).replace(/\\s+/g, "").replace(/,/g, "");
    const mWan = t.match(/([\\d.]+)\\s*万/);
    if (mWan) return String(Math.round(parseFloat(mWan[1]) * 10000));
    const m = t.match(/(\\d+)/);
    return m ? m[1] : "";
  };
  const cards = new Map();
  const fillMeta = (root) => {
    let title = "";
    const titleEl = root.querySelector(".footer .title, .title span, .title, .note-title, [class*='title']") || root.querySelector("a span, span");
    if (titleEl) title = (titleEl.textContent || "").trim();
    let cover = "";
    for (const img of root.querySelectorAll("img")) {
      const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (isCoverUrl(src)) { cover = abs(src); break; }
    }
    let likes = "";
    const likeCandidates = root.querySelectorAll(".like-wrapper, .count, .like, [class*='like'], [class*='interact'] span, [class*='footer'] span");
    for (const el of likeCandidates) {
      const t = (el.textContent || "").trim();
      if (!t || t.length > 12) continue;
      if (/赞|万|\\d/.test(t)) { const n = parseLikes(t); if (n !== "") { likes = n; break; } }
    }
    let type = "";
    if (root.querySelector('[class*="play"], [class*="video"], .play-icon, svg[class*="play"]')) type = "video";
    else if (cover || title) type = "normal";
    return { title, cover, likes, type };
  };
  const pushCard = (root, href) => {
    const link = abs(href);
    const noteId = noteIdFromHref(link);
    if (!noteId) return;
    const meta = fillMeta(root);
    const score = linkScore(link);
    const prev = cards.get(noteId);
    if (prev) {
      if (score > (prev._score || 0)) { prev["笔记链接"] = link; prev._score = score; }
      if (!prev["标题"] && meta.title) prev["标题"] = meta.title;
      if (!prev["封面图链接"] && meta.cover) prev["封面图链接"] = meta.cover;
      if (!prev["点赞数"] && meta.likes) prev["点赞数"] = meta.likes;
      if (!prev["笔记类型"] && meta.type) prev["笔记类型"] = meta.type === "video" ? "视频" : "图文";
      return;
    }
    cards.set(noteId, {
      note_id: noteId,
      标题: meta.title,
      笔记链接: link,
      封面图链接: meta.cover,
      点赞数: meta.likes,
      笔记类型: meta.type === "video" ? "视频" : meta.type ? "图文" : "",
      _score: score,
    });
  };
  const sels = ['a[href*="/user/profile/"]','a[href*="/explore/"]','a[href*="/search_result/"]','a[href*="/discovery/item/"]'];
  for (const a of document.querySelectorAll(sels.join(","))) {
    const full = a.href || "";
    const noteId = noteIdFromHref(full);
    if (!noteId) continue;
    const pathParts = (a.pathname || "").split("/").filter(Boolean);
    if (pathParts[0] === "user" && pathParts[1] === "profile" && pathParts.length < 4) continue;
    const root = a.closest("section") || a.closest('[class*="note"]') || a.closest("div") || a;
    pushCard(root, full);
  }
  return Array.from(cards.values()).map(({ _score, ...rest }) => rest);
})()`;

function linkScore(url) {
  const u = String(url || "").toLowerCase();
  let score = 0;
  if (u.includes("xsec_token=")) score += 100;
  if (u.includes("/user/profile/") && (u.match(/\//g) || []).length >= 6) score += 20;
  if (u.includes("/explore/") || u.includes("/search_result/")) score += 5;
  return score;
}

function coverFromNoteCard(noteCard) {
  const cover = noteCard.cover || {};
  if (cover && typeof cover === "object") {
    for (const key of ["url", "url_default", "info_list"]) {
      const val = cover[key];
      if (typeof val === "string" && val.startsWith("http")) return val;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && String(item.url || "").startsWith("http")) {
            return String(item.url);
          }
        }
      }
    }
  }
  const images = noteCard.image_list || [];
  if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
    return String(images[0].url || images[0].url_default || "");
  }
  return "";
}

function rowsFromApiPayload(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  let notes = null;
  for (const key of ["notes", "note_list", "items"]) {
    if (Array.isArray(data[key])) {
      notes = data[key];
      break;
    }
  }
  if (!notes && data.data && typeof data.data === "object") {
    return rowsFromApiPayload(data.data);
  }
  if (!Array.isArray(notes)) return out;

  for (const item of notes) {
    if (!item || typeof item !== "object") continue;
    const noteCard =
      item.note_card && typeof item.note_card === "object"
        ? item.note_card
        : item.note && typeof item.note === "object"
          ? item.note
          : item;
    const noteId = String(
      noteCard.note_id || noteCard.id || item.id || item.note_id || ""
    ).trim();
    if (!noteId || noteId === "hot_query" || noteId === "rec_query") continue;
    if (item.model_type && String(item.model_type).toLowerCase() === "query") continue;
    const xsecToken = String(item.xsec_token || noteCard.xsec_token || "").trim();
    const xsecSource =
      String(item.xsec_source || noteCard.xsec_source || "pc_search").trim() || "pc_search";
    let link = "";
    if (xsecToken) {
      link = `https://www.xiaohongshu.com/search_result/${noteId}?xsec_token=${encodeURIComponent(
        xsecToken
      )}&xsec_source=${encodeURIComponent(xsecSource)}`;
    }
    const row = rowFromProfileCard(noteCard, item, {
      noteId,
      noteLink: link,
      cover: coverFromNoteCard(noteCard),
    });
    out.push({ ...row, note_id: noteId });
  }
  return out;
}

function mergeRows(dst, rows) {
  let added = 0;
  if (!Array.isArray(rows)) return 0;
  for (const r of rows) {
    const nid = String(r.note_id || r["笔记ID"] || "").trim();
    if (!nid) continue;
    if (!dst[nid]) {
      const base = emptyNoteRow();
      for (const k of CSV_FIELDS) {
        if (r[k] != null && r[k] !== "") base[k] = String(r[k]);
      }
      base["笔记ID"] = base["笔记ID"] || nid;
      base.note_id = nid;
      dst[nid] = base;
      added += 1;
      continue;
    }
    const old = dst[nid];
    const newLink = r["笔记链接"] || "";
    if (linkScore(newLink) > linkScore(old["笔记链接"] || "")) old["笔记链接"] = newLink;
    for (const k of CSV_FIELDS) {
      if (k === "笔记链接") continue;
      const nv = r[k];
      if (nv == null || nv === "") continue;
      if (COUNT_KEYS.has(k) || !old[k]) old[k] = String(nv);
    }
  }
  return added;
}

function searchPageUrl(keyword) {
  const q = encodeURIComponent(String(keyword || "").trim());
  return `https://www.xiaohongshu.com/search_result?keyword=${q}&source=web_search_result_notes`;
}

function keywordSlug(keyword) {
  const raw = String(keyword || "kw")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 16);
  return raw || "kw";
}

async function closeExtraPages(context, keepPage) {
  for (const p of context.pages()) {
    if (p !== keepPage) await p.close().catch(() => {});
  }
}

function attachBlankPageGuard(context, page) {
  context.on("page", (p) => {
    if (p === page) return;
    p.once("domcontentloaded", () => {
      const u = p.url() || "";
      if (!u || u === "about:blank" || /chrome:\/\/|new-tab|newtab/i.test(u)) {
        p.close().catch(() => {});
      }
    });
  });
}

async function scrollCollect(page, { apiStore, maxNotes = 0, scrollPause = 1.5, log }) {
  const collected = {};
  let stagnant = 0;
  const unlimited = !maxNotes || maxNotes <= 0;
  await page.waitForTimeout(2000);
  mergeRows(collected, await page.evaluate(COLLECT_JS));
  mergeRows(collected, Object.values(apiStore));
  log.info(`首屏已见 ${Object.keys(collected).length} 条`);

  for (let round = 1; round <= 200; round += 1) {
    if (!unlimited && Object.keys(collected).length >= maxNotes) break;
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
      const cands = document.querySelectorAll(
        '[class*="scroll"], [class*="feed"], [class*="search"], main'
      );
      for (const el of cands) {
        if (el.scrollHeight > el.clientHeight + 50) {
          el.scrollTop = el.scrollTop + Math.floor(el.clientHeight * 0.85);
        }
      }
    });
    await page.waitForTimeout(Math.max(500, scrollPause * 1000));
    const added = mergeRows(collected, await page.evaluate(COLLECT_JS));
    mergeRows(collected, Object.values(apiStore));
    log.info(`滚动 ${round}: DOM+${added}，合计 ${Object.keys(collected).length}`);
    if (added === 0 && round > 1) {
      stagnant += 1;
      if (stagnant >= 4) {
        log.info("连续无新增，视为已到底");
        break;
      }
    } else stagnant = 0;
  }
  mergeRows(collected, Object.values(apiStore));
  let rows = Object.values(collected);
  if (!unlimited) rows = rows.slice(0, maxNotes);
  return rows;
}

/**
 * 按关键词搜索采集笔记列表（受 maxNotes 限制），写出 CSV/预览表。
 */
async function fetchSearchNotes({
  keyword,
  keywords,
  maxNotes = 20,
  scrollPause = 1.5,
  dataDir = XHS_DATA_DIR,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  const list = [];
  if (Array.isArray(keywords)) {
    for (const k of keywords) {
      const t = String(k || "").trim();
      if (t) list.push(t);
    }
  }
  const one = String(keyword || "").trim();
  if (one && !list.includes(one)) list.unshift(one);
  if (!list.length) throw new Error("请提供至少一个搜索词");

  let limit = Number(maxNotes);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(150, Math.floor(limit));

  fs.mkdirSync(dataDir, { recursive: true });
  const browser = await launchChromium(getChromium());
  const context = await browser.newContext(defaultContextOptions());
  await closeExtraPages(context, null);
  let page = await context.newPage();
  attachBlankPageGuard(context, page);

  const allResults = [];

  try {
    await auth.ensureLogin(page, context, log);
    await closeExtraPages(context, page);

    for (let ki = 0; ki < list.length; ki += 1) {
      const kw = list[ki];
      if (ki > 0) {
        await page.close().catch(() => {});
        page = await context.newPage();
        attachBlankPageGuard(context, page);
      }

      const apiStore = {};
      page.on("response", async (resp) => {
        try {
          const respUrl = resp.url() || "";
          if (resp.status() !== 200) return;
          if (!respUrl.includes("xiaohongshu.com") && !respUrl.includes("xhscdn")) return;
          const low = respUrl.toLowerCase();
          if (!SEARCH_API_HINTS.some((h) => low.includes(h))) return;
          const body = await resp.text();
          if (!body || (body[0] !== "{" && body[0] !== "[")) return;
          const payload = JSON.parse(body);
          let rows = rowsFromApiPayload(payload);
          if (!rows.length && payload && typeof payload === "object") {
            rows = rowsFromApiPayload(payload.data);
          }
          if (rows.length) mergeRows(apiStore, rows);
        } catch (_) {
          /* ignore */
        }
      });

      const url = searchPageUrl(kw);
      log.info(`打开搜索: ${kw} → ${url} · 目标 ${limit} 条`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await closeExtraPages(context, page);
      await page.waitForTimeout(2000);
      if (!(await auth.isLoggedIn(page, context))) {
        log.info("打开搜索页后登录态异常，请扫码...");
        if (!(await auth.waitLoginSuccess(page, context, 300, log))) {
          throw new Error("登录失败");
        }
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await closeExtraPages(context, page);
        await page.waitForTimeout(2000);
      }

      // 优先点「笔记」筛选（若有）
      try {
        const noteTab = page.locator('text=笔记').first();
        if (await noteTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await noteTab.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      } catch (_) {
        /* ignore */
      }

      const rows = await scrollCollect(page, { apiStore, maxNotes: limit, scrollPause, log });
      if (!rows.length) {
        throw new Error(`搜索「${kw}」未采到笔记，请确认已登录且搜索页可访问`);
      }

      const fetchedAt = nowText();
      for (const r of rows) {
        if (!r["采集时间"]) r["采集时间"] = fetchedAt;
        if (r["笔记类型"] === "video") r["笔记类型"] = "视频";
        else if (r["笔记类型"] === "normal" || r["笔记类型"] === "image") r["笔记类型"] = "图文";
        else if (r["笔记类型"] && !/图文|视频/.test(r["笔记类型"])) {
          r["笔记类型"] = formatType(r["笔记类型"]);
        }
        if (!r["笔记ID"] && r.note_id) r["笔记ID"] = r.note_id;
      }

      const slug = keywordSlug(kw);
      const batchStem = `xhs_search_${slug}_${stamp()}`;
      const csvPath = path.join(dataDir, `${batchStem}.csv`);
      exportCsv(rows, csvPath);
      const xlsxPath = await writeNoteTable(path.join(dataDir, `${batchStem}_preview.xlsx`), rows);
      log.info(`[${kw}] 完成 ${rows.length} 条 -> ${csvPath}`);
      log.info(`[${kw}] 预览表: ${xlsxPath}`);

      allResults.push({
        keyword: kw,
        batch: batchStem,
        csvPath,
        xlsxPath,
        count: rows.length,
      });
    }

    const total = allResults.reduce((n, r) => n + (r.count || 0), 0);
    return {
      ok: true,
      keywords: list,
      limit,
      total,
      results: allResults,
      csvPath: allResults[0]?.csvPath || "",
      xlsxPath: allResults[0]?.xlsxPath || "",
      count: total,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { fetchSearchNotes, searchPageUrl };
