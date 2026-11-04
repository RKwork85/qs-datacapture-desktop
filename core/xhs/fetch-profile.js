const fs = require("fs");
const path = require("path");
const { getChromium } = require("../pw");
const { XHS_DATA_DIR, stamp, nowText } = require("../paths");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const auth = require("./auth");
const {
  XHS_NOTE_COLUMNS,
  emptyNoteRow,
  s,
  formatType,
  profileUrl,
  rowFromProfileCard,
  writeNoteTable,
} = require("./fields");

/** 主页采集导出列（与完整表一致，媒体路径等列可为空） */
const CSV_FIELDS = XHS_NOTE_COLUMNS;
const API_HINTS = ["user_posted", "user/notes", "user_notes", "/note/user", "posted_notes"];
const COUNT_KEYS = new Set(["点赞数", "收藏数", "评论数", "转发数"]);

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
})()`; /* IIFE：playwright 对字符串函数表达式不会自动调用 */

const PROFILE_AUTHOR_JS = `(() => {
  const abs = (href) => { try { return new URL(href, location.origin).href; } catch { return href || ""; } };
  let nickname = "";
  const nameEl =
    document.querySelector(".user-name, .user-nickname, [class*='user-name'], [class*='nickname']") ||
    document.querySelector("h1, h2");
  if (nameEl) nickname = (nameEl.textContent || "").trim().slice(0, 64);
  let avatarUrl = "";
  const imgs = document.querySelectorAll("img");
  for (const img of imgs) {
    const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (!src || !/^https?:/i.test(src)) continue;
    const cls = String(img.className || "");
    const alt = String(img.alt || "");
    if (/avatar|head|user-img|user_avatar/i.test(cls + " " + alt + " " + src)) {
      avatarUrl = abs(src);
      break;
    }
  }
  if (!avatarUrl) {
    for (const img of imgs) {
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (/avatar|head/i.test(src) && /^https?:/i.test(src)) {
        avatarUrl = abs(src);
        break;
      }
    }
  }
  return { nickname, avatarUrl };
})()`;

function userIdFromUrl(url) {
  const m = String(url).match(/\/user\/profile\/([^/?#]+)/);
  return m ? m[1] : "unknown";
}

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

function rowsFromApiPayload(data, userId = "", author = {}) {
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
    return rowsFromApiPayload(data.data, userId, author);
  }
  if (!Array.isArray(notes)) return out;

  for (const item of notes) {
    if (!item || typeof item !== "object") continue;
    const noteCard =
      item.note_card && typeof item.note_card === "object" ? item.note_card : item;
    const noteId = String(
      noteCard.note_id || noteCard.id || item.id || item.note_id || ""
    ).trim();
    if (!noteId || noteId === "hot_query" || noteId === "rec_query") continue;
    const xsecToken = String(item.xsec_token || noteCard.xsec_token || "").trim();
    const xsecSource =
      String(item.xsec_source || noteCard.xsec_source || "pc_user").trim() || "pc_user";
    let link = "";
    if (userId && xsecToken) {
      link = `https://www.xiaohongshu.com/user/profile/${userId}/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}`;
    } else if (xsecToken) {
      link = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}`;
    }
    const row = rowFromProfileCard(noteCard, item, {
      userId,
      nickname: author.nickname,
      avatarUrl: author.avatarUrl,
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

function stampAuthor(rows, author) {
  const nickname = s(author.nickname);
  const avatarUrl = s(author.avatarUrl);
  const uid = s(author.userId);
  const home = profileUrl(uid);
  for (const row of rows) {
    if (nickname && !row["作者昵称"]) row["作者昵称"] = nickname;
    if (uid && !row["作者ID"]) row["作者ID"] = uid;
    if (avatarUrl && !row["作者头像"]) row["作者头像"] = avatarUrl;
    if (home && !row["作者主页链接"]) row["作者主页链接"] = home;
    if (!row["笔记ID"] && row.note_id) row["笔记ID"] = row.note_id;
  }
  return rows;
}

function exportCsv(rows, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = [CSV_FIELDS.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_FIELDS.map((k) => {
        const v = String(row[k] ?? "");
        if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
        return v;
      }).join(",")
    );
  }
  fs.writeFileSync(outPath, "\ufeff" + lines.join("\n"), "utf8");
  return outPath;
}

async function evaluateCollect(page) {
  const rows = await page.evaluate(COLLECT_JS);
  return Array.isArray(rows) ? rows : [];
}

async function readProfileAuthor(page, userId) {
  try {
    const info = await page.evaluate(PROFILE_AUTHOR_JS);
    return {
      userId: s(userId),
      nickname: s(info?.nickname),
      avatarUrl: s(info?.avatarUrl),
    };
  } catch {
    return { userId: s(userId), nickname: "", avatarUrl: "" };
  }
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
  mergeRows(collected, await evaluateCollect(page));
  mergeRows(collected, Object.values(apiStore));
  log.info(`首屏已见 ${Object.keys(collected).length} 条`);

  for (let round = 1; round <= 200; round += 1) {
    if (!unlimited && Object.keys(collected).length >= maxNotes) break;
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
      const cands = document.querySelectorAll(
        '[class*="scroll"], [class*="feed"], main, #userPageContainer'
      );
      for (const el of cands) {
        if (el.scrollHeight > el.clientHeight + 50) {
          el.scrollTop = el.scrollTop + Math.floor(el.clientHeight * 0.85);
        }
      }
    });
    await page.waitForTimeout(Math.max(500, scrollPause * 1000));
    const added = mergeRows(collected, await evaluateCollect(page));
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

async function fetchProfileNotes(
  {
    profileUrl: profileUrlInput,
    maxNotes = 0,
    scrollPause = 1.5,
    dataDir = XHS_DATA_DIR,
    onLog,
  } = {}
) {
  const log = createLogger(onLog);
  const url = String(profileUrlInput || "").trim();
  if (!url.includes("/user/profile/")) {
    throw new Error("请传入个人主页链接，形如 https://www.xiaohongshu.com/user/profile/xxxx");
  }
  const userId = userIdFromUrl(url);
  const batchStem = `xhs_profile_notes_${userId}_${stamp()}`;
  const outPath = path.join(dataDir, `${batchStem}.csv`);

  const browser = await launchChromium(getChromium());
  const context = await browser.newContext(defaultContextOptions());
  await closeExtraPages(context, null);
  const page = await context.newPage();
  attachBlankPageGuard(context, page);

  const author = { userId, nickname: "", avatarUrl: "" };

  try {
    await auth.ensureLogin(page, context, log);
    await closeExtraPages(context, page);
    log.info(`打开主页: ${url}`);
    const apiStore = {};
    page.on("response", async (resp) => {
      try {
        const respUrl = resp.url() || "";
        if (resp.status() !== 200) return;
        if (!respUrl.includes("xiaohongshu.com") && !respUrl.includes("xhscdn")) return;
        const low = respUrl.toLowerCase();
        if (!API_HINTS.some((h) => low.includes(h))) return;
        const body = await resp.text();
        if (!body || (body[0] !== "{" && body[0] !== "[")) return;
        const payload = JSON.parse(body);
        let rows = rowsFromApiPayload(payload, userId, author);
        if (!rows.length && payload && typeof payload === "object") {
          rows = rowsFromApiPayload(payload.data, userId, author);
        }
        if (rows.length) {
          // 从首条 API 用户信息补作者
          for (const r of rows) {
            if (r["作者昵称"] && !author.nickname) author.nickname = r["作者昵称"];
            if (r["作者头像"] && !author.avatarUrl) author.avatarUrl = r["作者头像"];
            if (r["作者ID"] && !author.userId) author.userId = r["作者ID"];
          }
          mergeRows(apiStore, rows);
        }
      } catch (_) {
        /* ignore */
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await closeExtraPages(context, page);
    await page.waitForTimeout(2000);
    if (!(await auth.isLoggedIn(page, context))) {
      log.info("打开主页后登录态异常，请扫码...");
      if (!(await auth.waitLoginSuccess(page, context, 300, log))) {
        throw new Error("登录失败");
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await closeExtraPages(context, page);
      await page.waitForTimeout(2000);
    }

    const domAuthor = await readProfileAuthor(page, userId);
    if (domAuthor.nickname && !author.nickname) author.nickname = domAuthor.nickname;
    if (domAuthor.avatarUrl && !author.avatarUrl) author.avatarUrl = domAuthor.avatarUrl;
    author.userId = author.userId || userId;
    if (author.nickname || author.avatarUrl) {
      log.info(`作者: ${author.nickname || "-"} · 头像${author.avatarUrl ? "已取" : "未取到"}`);
    }

    const rows = await scrollCollect(page, { apiStore, maxNotes, scrollPause, log });
    if (!rows.length) throw new Error("未解析到笔记卡片");

    const fetchedAt = nowText();
    for (const r of rows) {
      if (!r["采集时间"]) r["采集时间"] = fetchedAt;
      if (r["笔记类型"] === "video") r["笔记类型"] = "视频";
      else if (r["笔记类型"] === "normal" || r["笔记类型"] === "image") r["笔记类型"] = "图文";
      else if (r["笔记类型"] && !/图文|视频/.test(r["笔记类型"])) {
        r["笔记类型"] = formatType(r["笔记类型"]);
      }
    }
    stampAuthor(rows, author);

    exportCsv(rows, outPath);
    const xlsxPath = await writeNoteTable(path.join(dataDir, `${batchStem}_preview.xlsx`), rows);
    log.info(`完成 ${rows.length} 条 -> ${outPath}`);
    log.info(`预览表: ${xlsxPath}`);
    await page.waitForTimeout(1500);
    return {
      ok: true,
      count: rows.length,
      csvPath: outPath,
      xlsxPath,
      nickname: author.nickname || "",
      userId,
      profileUrl: url,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { fetchProfileNotes, CSV_FIELDS, exportCsv };
