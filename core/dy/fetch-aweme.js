const fs = require("fs");
const path = require("path");
const { DY_DATA_DIR, ensureDirs, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const auth = require("./auth");
const { s, rowFromAweme, writeAwemeTable, profileUrl } = require("./fields");
const { fetchNoteMedia } = require("./fetch-media");

function extractAwemeId(url) {
  const raw = String(url || "").trim();
  let m = raw.match(/\/video\/(\d+)/i);
  if (m) return m[1];
  m = raw.match(/\/note\/(\d+)/i);
  if (m) return m[1];
  try {
    const u = new URL(raw);
    return u.searchParams.get("modal_id") || u.searchParams.get("aweme_id") || "";
  } catch {
    return "";
  }
}

function looksLikeVideoUrl(url) {
  const u = String(url || "");
  return /douyin\.com\/(?:video|note)\//i.test(u) || /[?&](?:modal_id|aweme_id)=\d+/i.test(u);
}

function putAweme(bag, item) {
  if (!item || typeof item !== "object") return;
  const id = item.aweme_id || item.awemeId;
  if (!id) return;
  bag.set(String(id), item);
}

function collectFromPayload(json, bag) {
  if (!json || typeof json !== "object") return;
  putAweme(bag, json.aweme_detail);
  putAweme(bag, json.data?.aweme_detail);
  const lists = [];
  if (Array.isArray(json.aweme_list)) lists.push(json.aweme_list);
  if (Array.isArray(json.data?.aweme_list)) lists.push(json.data.aweme_list);
  if (Array.isArray(json.data?.aweme_details)) lists.push(json.data.aweme_details);
  if (Array.isArray(json.aweme_details)) lists.push(json.aweme_details);
  for (const list of lists) {
    for (const item of list) putAweme(bag, item);
  }
}

function attachDetailListener(page, bag) {
  page.on("response", (res) => {
    const u = res.url();
    // 详情页常见 detail；偶发走其它 aweme JSON
    if (!/\/aweme\/v1\/web\/(?:aweme\/detail|multi\/aweme\/detail|aweme\/)/i.test(u)) return;
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json") && !ct.includes("javascript") && !ct.includes("text")) return;
    res
      .text()
      .then((txt) => {
        try {
          collectFromPayload(JSON.parse(txt), bag);
        } catch (_) {
          /* ignore */
        }
      })
      .catch(() => {});
  });
}

async function waitForId(bag, awemeId, timeoutMs = 15000) {
  const start = Date.now();
  const want = String(awemeId || "");
  while (Date.now() - start < timeoutMs) {
    if (want && bag.has(want)) return bag.get(want);
    if (!want && bag.size) return bag.values().next().value;
    await new Promise((r) => setTimeout(r, 350));
  }
  return want && bag.has(want) ? bag.get(want) : bag.values().next().value || null;
}

async function tryParsePageState(page) {
  try {
    return await page.evaluate(() => {
      const out = [];
      const push = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (obj.aweme_id || obj.awemeId) out.push(obj);
        if (obj.aweme_detail) out.push(obj.aweme_detail);
      };
      const candidates = [
        window.__INIT_PROPS__,
        window._ROUTER_DATA,
        window.__NEXT_DATA__,
        window.RENDER_DATA,
      ];
      for (const c of candidates) {
        try {
          const raw = typeof c === "string" ? JSON.parse(decodeURIComponent(c)) : c;
          push(raw);
          push(raw?.loaderData);
          if (raw?.loaderData && typeof raw.loaderData === "object") {
            for (const v of Object.values(raw.loaderData)) push(v);
          }
        } catch (_) {
          /* ignore */
        }
      }
      const el = document.getElementById("RENDER_DATA");
      if (el && el.textContent) {
        try {
          const raw = JSON.parse(decodeURIComponent(el.textContent));
          const walk = (node, depth = 0) => {
            if (!node || depth > 8) return;
            if (Array.isArray(node)) {
              node.forEach((x) => walk(x, depth + 1));
              return;
            }
            if (typeof node !== "object") return;
            if (node.aweme_id || node.awemeId || node.aweme_detail) push(node);
            Object.values(node).forEach((v) => walk(v, depth + 1));
          };
          walk(raw);
        } catch (_) {
          /* ignore */
        }
      }
      return out[0] || null;
    });
  } catch {
    return null;
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

/**
 * 按作品链接直采详情（可多条），写出 CSV/预览表，并默认下载媒体。
 */
async function fetchAwemeByUrls({
  urls = [],
  download = true,
  onLog,
  keepOpen = false,
} = {}) {
  const log = createLogger(onLog);
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (!list.length) throw new Error("请提供至少一条抖音作品链接");

  for (const u of list) {
    if (!looksLikeVideoUrl(u) && !extractAwemeId(u)) {
      throw new Error(`不是有效的抖音作品链接: ${u}`);
    }
  }

  ensureDirs();
  const { browser, context } = await auth.openContextWithAuth();
  const page = await context.newPage();
  context.on("page", (p) => {
    if (p === page) return;
    p.once("domcontentloaded", () => {
      const u = p.url() || "";
      if (!u || u === "about:blank" || /chrome:\/\/|new-tab|newtab/i.test(u)) {
        p.close().catch(() => {});
      }
    });
  });

  const bag = new Map();
  attachDetailListener(page, bag);
  const awemes = [];

  try {
    for (const videoUrl of list) {
      const awemeId = extractAwemeId(videoUrl);
      log.info(`打开作品: ${videoUrl}${awemeId ? ` (id=${awemeId})` : ""}`);
      bag.clear();
      await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      for (const p of context.pages()) {
        if (p !== page) await p.close().catch(() => {});
      }

      let aweme = await waitForId(bag, awemeId, 12000);
      if (!aweme) {
        const fromPage = await tryParsePageState(page);
        if (fromPage) {
          putAweme(bag, fromPage);
          aweme =
            (awemeId && bag.get(String(awemeId))) ||
            fromPage;
        }
      }
      if (!aweme && awemeId) {
        // 再等一轮：部分详情接口较慢
        aweme = await waitForId(bag, awemeId, 8000);
      }
      if (!aweme) {
        throw new Error(`未解析到作品详情，请确认已登录且链接可访问: ${videoUrl}`);
      }
      awemes.push(aweme);
      log.info(`已解析作品 ${aweme.aweme_id || aweme.awemeId || awemeId}`);
    }

    const fetchedAt = nowText();
    const first = awemes[0] || {};
    const nickname = s(first?.author?.nickname || "douyin");
    const shortId = s(first?.author?.uid || extractAwemeId(list[0]) || "video").slice(0, 12);
    const batch = `dy_aweme_${shortId}_${stamp()}`;
    const csvPath = path.join(DY_DATA_DIR, `${batch}.csv`);
    const rows = awemes.map((a) => {
      const secUid = a?.author?.sec_uid || "";
      return rowFromAweme(a, { fetchedAt, secUid, profileUrl: profileUrl(secUid) });
    });
    writeCsv(csvPath, rows);
    const xlsxPath = await writeAwemeTable(path.join(DY_DATA_DIR, `${batch}_preview.xlsx`), rows);
    log.info(`CSV: ${csvPath}`);
    log.info(`预览表: ${xlsxPath}`);
    log.info(`昵称: ${nickname} · 条数: ${rows.length}`);

    let mediaResult = null;
    if (download) {
      log.info("开始下载媒体…");
      mediaResult = await fetchNoteMedia({
        csvPath,
        maxNotes: rows.length,
        noteType: "all",
        onLog,
      });
    }

    if (!keepOpen) await browser.close().catch(() => {});
    else log.info("浏览器保持打开");

    return {
      ok: true,
      csvPath,
      xlsxPath,
      count: rows.length,
      nickname,
      batch,
      urls: list,
      outRoot: mediaResult?.outRoot || "",
      downloadOk: mediaResult?.downloadOk,
      downloadFail: mediaResult?.downloadFail,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = {
  fetchAwemeByUrls,
  extractAwemeId,
  looksLikeVideoUrl,
};
