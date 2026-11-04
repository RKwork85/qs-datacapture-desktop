const fs = require("fs");
const path = require("path");
const { DY_DATA_DIR, ensureDirs, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const auth = require("./auth");
const { s, rowFromAweme, writeAwemeTable, profileUrl } = require("./fields");
const { MAX_ITEMS_HARD } = require("./fetch-profile");

function putAweme(bag, item) {
  if (!item || typeof item !== "object") return;
  const id = item.aweme_id || item.awemeId;
  if (!id) return;
  bag.set(String(id), item);
}

/** 搜索接口常见结构：data[] / data.data[] 内含 aweme_info */
function collectFromSearchPayload(json, bag) {
  if (!json || typeof json !== "object") return;
  putAweme(bag, json.aweme_detail);
  putAweme(bag, json.aweme_info);
  if (Array.isArray(json.aweme_list)) {
    for (const a of json.aweme_list) putAweme(bag, a);
  }
  const chunks = [];
  if (Array.isArray(json.data)) chunks.push(json.data);
  if (Array.isArray(json.data?.data)) chunks.push(json.data.data);
  if (Array.isArray(json.data?.aweme_list)) chunks.push(json.data.aweme_list);
  if (Array.isArray(json.data?.business_data)) chunks.push(json.data.business_data);
  for (const list of chunks) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      putAweme(bag, item.aweme_info);
      putAweme(bag, item.aweme);
      putAweme(bag, item.aweme_detail);
      if (item.aweme_id || item.awemeId) putAweme(bag, item);
      if (item.data && typeof item.data === "object") {
        putAweme(bag, item.data.aweme_info);
        putAweme(bag, item.data);
      }
    }
  }
}

function attachSearchListener(page, bag) {
  page.on("response", (res) => {
    const u = res.url();
    if (!/\/aweme\/v1\/web\/(?:general\/search|search\/item|aweme\/search)/i.test(u)) return;
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json") && !ct.includes("javascript") && !ct.includes("text")) return;
    res
      .text()
      .then((txt) => {
        try {
          collectFromSearchPayload(JSON.parse(txt), bag);
        } catch (_) {
          /* ignore */
        }
      })
      .catch(() => {});
  });
}

async function waitForAwemes(bag, want, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (bag.size >= want) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

function writeCsv(csvPath, rows) {
  const headers = Object.keys(rows[0] || {});
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = String(r[h] ?? "").replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(",")
    );
  }
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");
}

function searchPageUrl(keyword) {
  const q = encodeURIComponent(String(keyword || "").trim());
  // type=video 更贴近作品流；general 也可抓到视频
  return `https://www.douyin.com/search/${q}?type=video`;
}

function keywordSlug(keyword) {
  const raw = String(keyword || "kw")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 16);
  return raw || "kw";
}

/**
 * 按关键词搜索采集作品列表（受 maxNotes 限制），写出 CSV/预览表。
 */
async function fetchSearchNotes({
  keyword,
  keywords,
  maxNotes = 20,
  onLog,
  keepOpen = false,
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
  limit = Math.min(MAX_ITEMS_HARD, Math.floor(limit));

  ensureDirs();
  const { browser, context } = await auth.openContextWithAuth();
  let page = await context.newPage();
  context.on("page", (p) => {
    if (p === page) return;
    p.once("domcontentloaded", () => {
      const u = p.url() || "";
      if (!u || u === "about:blank" || /chrome:\/\/|new-tab|newtab/i.test(u)) {
        p.close().catch(() => {});
      }
    });
  });

  const allResults = [];

  try {
    for (let ki = 0; ki < list.length; ki += 1) {
      const kw = list[ki];
      if (ki > 0) {
        await page.close().catch(() => {});
        page = await context.newPage();
      }
      const bag = new Map();
      attachSearchListener(page, bag);
      const url = searchPageUrl(kw);
      log.info(`打开搜索: ${kw} → ${url} · 目标 ${limit} 条`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      for (const p of context.pages()) {
        if (p !== page) await p.close().catch(() => {});
      }

      await waitForAwemes(bag, Math.min(5, limit), 14000);
      log.info(`[${kw}] 首屏捕获 ${bag.size}/${limit}`);

      let stagnant = 0;
      let last = bag.size;
      for (let i = 0; i < 50 && bag.size < limit; i += 1) {
        await page.mouse.wheel(0, 2800);
        await waitForAwemes(bag, last + 1, 2800);
        if (bag.size === last) stagnant += 1;
        else stagnant = 0;
        last = bag.size;
        if (i % 2 === 1 || bag.size >= limit) {
          log.info(`[${kw}] 已捕获 ${bag.size}/${limit}`);
        }
        if (stagnant >= 6) break;
      }

      const awemes = Array.from(bag.values()).slice(0, limit);
      if (!awemes.length) {
        throw new Error(`搜索「${kw}」未采到作品，请确认已登录且搜索页可访问`);
      }

      const fetchedAt = nowText();
      const slug = keywordSlug(kw);
      const batch = `dy_search_${slug}_${stamp()}`;
      const csvPath = path.join(DY_DATA_DIR, `${batch}.csv`);
      const rows = awemes.map((a) => {
        const secUid = a?.author?.sec_uid || "";
        return rowFromAweme(a, {
          fetchedAt,
          secUid,
          profileUrl: profileUrl(secUid),
        });
      });
      writeCsv(csvPath, rows);
      const xlsxPath = await writeAwemeTable(
        path.join(DY_DATA_DIR, `${batch}_preview.xlsx`),
        rows
      );
      log.info(`[${kw}] CSV: ${csvPath}`);
      log.info(`[${kw}] 预览表: ${xlsxPath}`);
      log.info(`[${kw}] 条数: ${rows.length}`);

      allResults.push({
        keyword: kw,
        batch,
        csvPath,
        xlsxPath,
        count: rows.length,
      });
    }

    if (!keepOpen) await browser.close().catch(() => {});
    else log.info("浏览器保持打开");

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
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { fetchSearchNotes, searchPageUrl };
