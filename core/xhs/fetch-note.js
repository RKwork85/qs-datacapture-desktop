const { getChromium } = require("../pw");
const { createLogger } = require("../logger");
const { launchChromium, defaultContextOptions } = require("../browser");
const auth = require("./auth");
const { noteIdFromUrl, fetchNoteMedia } = require("./fetch-media");

function looksLikeNoteUrl(url) {
  const u = String(url || "").trim();
  if (!u) return false;
  if (/xhslink\.com/i.test(u)) return true;
  if (/xiaohongshu\.com\/(?:explore|discovery\/item|search_result)\//i.test(u)) return true;
  if (/xiaohongshu\.com\/user\/profile\/[^/?#]+\/[0-9a-f]+/i.test(u)) return true;
  return false;
}

function hasUsableToken(url) {
  const u = String(url || "");
  return Boolean(noteIdFromUrl(u) && /[?&]xsec_token=/i.test(u));
}

async function closeExtraPages(context, keepPage) {
  for (const p of context.pages()) {
    if (p !== keepPage) await p.close().catch(() => {});
  }
}

/**
 * 打开笔记页，尽量拿到带 xsec_token 的最终链接。
 */
async function resolveNoteUrl(page, rawUrl, log) {
  const input = String(rawUrl || "").trim();
  if (!input) return "";
  if (hasUsableToken(input)) return input;

  log.info(`解析笔记链接: ${input.slice(0, 120)}`);
  await page.goto(input, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2200);

  for (let i = 0; i < 8; i += 1) {
    const current = page.url() || "";
    if (hasUsableToken(current)) return current;

    const fromDom = await page.evaluate(() => {
      const href = String(location.href || "");
      if (/xsec_token=/i.test(href)) return href;
      const canon = document.querySelector('link[rel="canonical"]');
      if (canon && /xsec_token=/i.test(canon.href || "")) return canon.href;
      const share = document.querySelector('a[href*="xsec_token="], meta[property="og:url"]');
      if (share) {
        const v = share.getAttribute("href") || share.getAttribute("content") || "";
        if (/xsec_token=/i.test(v)) return v;
      }
      try {
        const state =
          window.__INITIAL_STATE__ ||
          window.__INITIAL_SSR_STATE__ ||
          window.__NEXT_DATA__ ||
          null;
        const text = state ? JSON.stringify(state) : "";
        const m = text.match(
          /https?:\\\/\\\/www\.xiaohongshu\.com\\\/(?:explore|discovery\\\/item|search_result|user\\\/profile\\\/[^"\\]+)\\\/[0-9a-f]+[^"\\]*xsec_token=[^"\\]+/i
        );
        if (m) return m[0].replace(/\\\//g, "/").replace(/\\u002F/g, "/");
        const tokenM = text.match(/"xsec_token"\s*:\s*"([^"]+)"/);
        const idM = text.match(/"noteId"\s*:\s*"([0-9a-f]+)"/i) || text.match(/"note_id"\s*:\s*"([0-9a-f]+)"/i);
        if (tokenM && idM) {
          return `https://www.xiaohongshu.com/explore/${idM[1]}?xsec_token=${encodeURIComponent(
            tokenM[1]
          )}&xsec_source=pc_user`;
        }
      } catch (_) {
        /* ignore */
      }
      return "";
    });
    if (fromDom && hasUsableToken(fromDom)) return fromDom;
    await page.waitForTimeout(600);
  }

  const fallback = page.url() || input;
  if (hasUsableToken(fallback)) return fallback;
  log.warn(`未能补全 xsec_token: ${input.slice(0, 80)}`);
  return "";
}

/**
 * 按笔记 URL 批量直采（自动解析短链 / 无 token 链接，再走 HTTP 媒体下载）。
 */
async function fetchNotesByUrls({ urls = [], maxNotes = 20, onLog } = {}) {
  const log = createLogger(onLog);
  const list = (Array.isArray(urls) ? urls : [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (!list.length) throw new Error("请提供至少一条笔记链接");

  let limit = Number(maxNotes);
  if (!Number.isFinite(limit) || limit <= 0) limit = list.length;
  limit = Math.min(150, Math.floor(limit));

  const ready = [];
  const needResolve = [];
  for (const u of list) {
    if (hasUsableToken(u)) ready.push(u);
    else needResolve.push(u);
  }

  if (needResolve.length) {
    const browser = await launchChromium(getChromium());
    const context = await browser.newContext(defaultContextOptions());
    await closeExtraPages(context, null);
    const page = await context.newPage();
    try {
      await auth.ensureLogin(page, context, log);
      await closeExtraPages(context, page);
      for (const raw of needResolve) {
        if (ready.length >= limit) break;
        try {
          const resolved = await resolveNoteUrl(page, raw, log);
          if (resolved) {
            ready.push(resolved);
            log.info(`已解析: ${noteIdFromUrl(resolved)}`);
          }
        } catch (e) {
          log.warn(`解析失败: ${String(e.message || e).slice(0, 120)}`);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  const unique = [];
  const seen = new Set();
  for (const u of ready) {
    const nid = noteIdFromUrl(u);
    if (!nid || seen.has(nid)) continue;
    seen.add(nid);
    unique.push(u);
    if (unique.length >= limit) break;
  }
  if (!unique.length) {
    throw new Error("未能解析出有效笔记链接（需要带 xsec_token 的 explore/主页笔记链）");
  }

  log.info(`开始直采 ${unique.length} 条笔记…`);
  return fetchNoteMedia({ urls: unique, maxNotes: unique.length, onLog });
}

module.exports = {
  fetchNotesByUrls,
  looksLikeNoteUrl,
  noteIdFromUrl,
  hasUsableToken,
  resolveNoteUrl,
};
