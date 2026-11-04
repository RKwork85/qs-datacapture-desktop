const fs = require("fs");
const path = require("path");
const { DY_DATA_DIR, ensureDirs, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const auth = require("./auth");
const { s, rowFromAweme, writeAwemeTable, profileUrl } = require("./fields");

const MAX_ITEMS_HARD = 150;

function extractSecUid(url) {
  const m = String(url || "").match(/\/user\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : "";
}

function looksLikeProfileUrl(url) {
  return /douyin\.com\/user\//i.test(url);
}

function collectFromPayload(json, bag) {
  if (!json || typeof json !== "object") return;
  const lists = [];
  if (Array.isArray(json.aweme_list)) lists.push(json.aweme_list);
  if (Array.isArray(json.data?.aweme_list)) lists.push(json.data.aweme_list);
  if (Array.isArray(json.data?.list)) lists.push(json.data.list);
  for (const list of lists) {
    for (const item of list) {
      const id = item?.aweme_id || item?.awemeId;
      if (!id || bag.has(String(id))) continue;
      bag.set(String(id), item);
    }
  }
}

/** 必须立刻读 body，避免 Playwright 丢弃大响应 */
function attachAwemeListener(page, bag) {
  page.on("response", (res) => {
    const u = res.url();
    if (!/\/aweme\/v1\/web\/aweme\/post\/?/i.test(u)) return;
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json") && !ct.includes("javascript") && !ct.includes("text")) return;
    // 同步启动读取，不在 await 其它逻辑之后
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

async function waitForAwemes(bag, want, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (bag.size >= want) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function fetchProfileNotes({
  profileUrl: rawUrl,
  maxNotes = 50,
  onLog,
  keepOpen = false,
} = {}) {
  const log = createLogger(onLog);
  const profileUrlInput = String(rawUrl || "").trim();
  if (!looksLikeProfileUrl(profileUrlInput)) {
    throw new Error("请填写有效的抖音主页链接（需包含 /user/）");
  }
  const secUid = extractSecUid(profileUrlInput);
  let limit = Number(maxNotes);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  limit = Math.min(MAX_ITEMS_HARD, Math.floor(limit));

  ensureDirs();
  const { browser, context } = await auth.openContextWithAuth();
  const page = await context.newPage();
  // 采集过程中若弹出多余标签（广告/空白），关掉，只保留主采集页
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
  attachAwemeListener(page, bag);

  try {
    log.info(`打开主页: ${profileUrlInput}`);
    await page.goto(profileUrlInput, { waitUntil: "domcontentloaded", timeout: 60000 });
    for (const p of context.pages()) {
      if (p !== page) await p.close().catch(() => {});
    }
    await waitForAwemes(bag, Math.min(5, limit), 12000);
    log.info(`首屏捕获作品 ${bag.size}/${limit}`);

    let stagnant = 0;
    let last = bag.size;
    for (let i = 0; i < 40 && bag.size < limit; i += 1) {
      await page.mouse.wheel(0, 2400);
      await waitForAwemes(bag, last + 1, 2500);
      if (bag.size === last) stagnant += 1;
      else stagnant = 0;
      last = bag.size;
      log.info(`已捕获作品 ${bag.size}/${limit}`);
      if (stagnant >= 5) break;
    }

    const awemes = Array.from(bag.values()).slice(0, limit);
    if (!awemes.length) {
      throw new Error("未采集到作品，请确认已登录且主页可访问");
    }

    const fetchedAt = nowText();
    const nickname = s(awemes[0]?.author?.nickname || "douyin");
    const shortId = s(awemes[0]?.author?.uid || secUid).slice(0, 12) || "user";
    const batch = `dy_aweme_${shortId}_${stamp()}`;
    const csvPath = path.join(DY_DATA_DIR, `${batch}.csv`);
    const rows = awemes.map((a) =>
      rowFromAweme(a, { fetchedAt, secUid, profileUrl: profileUrl(secUid) })
    );

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
    const xlsxPath = await writeAwemeTable(path.join(DY_DATA_DIR, `${batch}_preview.xlsx`), rows);

    log.info(`CSV: ${csvPath}`);
    log.info(`预览表: ${xlsxPath}`);
    log.info(`昵称: ${nickname} · 条数: ${rows.length}`);

    if (!keepOpen) await browser.close().catch(() => {});
    else log.info("浏览器保持打开");

    return {
      ok: true,
      csvPath,
      xlsxPath,
      count: rows.length,
      nickname,
      secUid,
      batch,
      profileUrl: profileUrlInput,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { fetchProfileNotes, extractSecUid, looksLikeProfileUrl, MAX_ITEMS_HARD };
