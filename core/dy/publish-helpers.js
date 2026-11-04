const fs = require("fs");
const path = require("path");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v"]);

class PublishError extends Error {}

function collectImages(folderPath) {
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return [];
  return fs
    .readdirSync(folderPath)
    .map((name) => path.join(folderPath, name))
    .filter((p) => fs.statSync(p).isFile() && IMAGE_EXTS.has(path.extname(p).toLowerCase()))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
}

function resolveVideoPath(pathStr) {
  let p = path.resolve(String(pathStr || ""));
  if (!fs.existsSync(p)) throw new PublishError(`视频不存在：${pathStr}`);
  if (fs.statSync(p).isDirectory()) {
    const files = fs
      .readdirSync(p)
      .map((name) => path.join(p, name))
      .filter((f) => fs.statSync(f).isFile() && VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
    if (!files.length) throw new PublishError(`目录中未找到视频：${pathStr}`);
    p = files[0];
  } else if (!VIDEO_EXTS.has(path.extname(p).toLowerCase())) {
    throw new PublishError(`不支持的视频后缀：${path.extname(p)}`);
  }
  return p;
}

function parseTags(tagsStr) {
  return String(tagsStr || "")
    .split(/[\s,，#]+/)
    .map((t) => String(t || "").replace(/[\[\]【】]/g, "").trim())
    .filter(Boolean);
}

/** 页面是否出现验证码/人机校验 */
async function detectCaptcha(page) {
  return page.evaluate(() => {
    const text = (document.body && document.body.innerText) || "";
    if (/滑动验证|请完成验证|安全验证|验证码|拖动滑块|人机验证|captcha/i.test(text)) {
      return true;
    }
    const sels = [
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
      "#captcha_container",
      ".captcha_verify_container",
      ".captcha-disable-scroll",
      "[class*='captcha']",
      "[id*='captcha']",
      "[class*='verify-wrap']",
      "[class*='secsdk']",
    ];
    for (const s of sels) {
      if (document.querySelector(s)) return true;
    }
    return false;
  });
}

/**
 * 若出现验证码则等待用户手动完成；超时抛错停止。
 * @param {number} timeoutMs 默认 3 分钟
 */
async function waitCaptchaIfNeeded(page, log, timeoutMs = 180000) {
  if (!(await detectCaptcha(page))) return false;
  log.warn("检测到验证码/安全验证，请在浏览器中完成；超时将停止");
  const deadline = Date.now() + timeoutMs;
  let lastHint = 0;
  while (Date.now() < deadline) {
    if (!(await detectCaptcha(page))) {
      log.info("验证码已通过，继续执行");
      await page.waitForTimeout(800);
      return true;
    }
    if (Date.now() - lastHint > 15000) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      log.info(`仍在等待验证码…剩余约 ${left}s`);
      lastHint = Date.now();
    }
    await page.waitForTimeout(1200);
  }
  throw new PublishError("验证码等待超时，已停止运行");
}

async function clickByTexts(page, texts, log) {
  const hit = await page.evaluate((list) => {
    const want = list.map((t) => String(t).trim()).filter(Boolean);
    for (const el of document.querySelectorAll("div, span, button, a, label, p, li")) {
      const t = (el.textContent || "").trim();
      if (!want.includes(t) || t.length > 24) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      el.click();
      return t;
    }
    return "";
  }, texts);
  if (hit) {
    log.info(`已点击：${hit}`);
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function setFilesViaInput(page, filePaths, prefer) {
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  if (!n) return false;
  let best = 0;
  if (prefer === "image" || prefer === "video") {
    best = await page.evaluate((kind) => {
      const list = [...document.querySelectorAll('input[type="file"]')];
      let bi = 0;
      let bs = -999;
      list.forEach((inp, idx) => {
        const acc = (inp.getAttribute("accept") || "").toLowerCase();
        let s = 0;
        if (kind === "video") {
          if (acc.includes("video") || acc.includes("mp4")) s += 10;
          if (acc.includes("image") && !acc.includes("video")) s -= 8;
        } else {
          if (acc.includes("image") || acc.includes("png") || acc.includes("jpeg")) s += 10;
          if (acc.includes("video") && !acc.includes("image")) s -= 8;
        }
        if (s > bs) {
          bs = s;
          bi = idx;
        }
      });
      return bi;
    }, prefer);
  }
  try {
    await inputs.nth(best).setInputFiles(filePaths);
    return true;
  } catch (_) {
    for (let i = 0; i < n; i += 1) {
      try {
        await inputs.nth(i).setInputFiles(filePaths);
        return true;
      } catch (_) {
        /* next */
      }
    }
  }
  return false;
}

async function fillByPlaceholders(page, placeholders, text, maxLen = 0) {
  const value = maxLen > 0 ? String(text || "").slice(0, maxLen) : String(text || "");
  for (const ph of placeholders) {
    const loc = page.locator(`input[placeholder*='${ph}'], textarea[placeholder*='${ph}']`).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.waitFor({ state: "visible", timeout: 4000 });
      await loc.fill(value);
      return true;
    } catch (_) {
      /* next */
    }
  }
  const editable = page.locator("[contenteditable='true']").first();
  if ((await editable.count()) > 0) {
    try {
      await editable.click({ timeout: 3000 });
      await page.keyboard.type(value, { delay: 20 });
      return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

async function waitPublishSuccess(page, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url() || "";
    if (/success|publish\/manage|content\/manage|creation/i.test(url)) return true;
    const ok = await page.evaluate(() => {
      const t = (document.body && document.body.innerText) || "";
      return /发布成功|已发布|上传成功/.test(t);
    });
    if (ok) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

/**
 * 抖音创作者中心：点选「定时发布」并尽量写入时间。
 * @returns {Promise<boolean>}
 */
async function enableSchedule(page, scheduleTime, log = console) {
  const info = typeof log.info === "function" ? log.info.bind(log) : console.log;
  const warn = typeof log.warn === "function" ? log.warn.bind(log) : console.warn;

  const hit = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("label, span, div, button, p")];
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s+/g, "");
      if (t !== "定时发布") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // 优先点同级 radio
      const row = el.closest("label, .radio, [class*='radio'], div") || el;
      const input = row.querySelector('input[type="radio"]');
      if (input) {
        input.click();
        return "radio";
      }
      el.click();
      return "text";
    }
    return "";
  });
  if (!hit) {
    warn("未找到抖音「定时发布」选项");
    return false;
  }
  info(`已选择定时发布（${hit}）`);
  await page.waitForTimeout(600);

  const timeStr = String(scheduleTime || "").trim().slice(0, 16);
  if (!timeStr) {
    warn("未提供定时时间，将使用页面默认时间");
    return true;
  }

  // 常见时间输入：datetime / placeholder 含 日期|时间
  const filled = await page.evaluate((want) => {
    const inputs = [
      ...document.querySelectorAll(
        "input[type='datetime-local'], input[placeholder*='日期'], input[placeholder*='时间'], input[placeholder*='选择']"
      ),
    ];
    for (const el of inputs) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el.focus();
      el.value = want;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, timeStr.replace(" ", "T"));

  if (filled) {
    info(`已写入定时时间：${timeStr}`);
  } else {
    // 再试 fill locator
    try {
      const loc = page
        .locator(
          "input[placeholder*='日期'], input[placeholder*='时间'], input[type='datetime-local']"
        )
        .first();
      if ((await loc.count()) > 0) {
        await loc.fill(timeStr);
        info(`已填写定时时间：${timeStr}`);
      } else {
        warn(`未能自动写入定时时间 ${timeStr}，请确认页面时间控件`);
      }
    } catch (e) {
      warn(`写入定时时间失败：${e.message || e}`);
    }
  }
  await page.waitForTimeout(500);
  return true;
}

/** 抖音「自主声明」 */
const DY_DECLARATIONS = [
  "内容由AI生成",
  "内容为个人观点或见解",
  "内容为转载信息",
  "内容含营销推广信息",
  "虚构演绎，仅供娱乐",
  "无需添加自主声明",
];

async function setSelfDeclaration(page, declaration, log = console) {
  const info = typeof log.info === "function" ? log.info.bind(log) : console.log;
  const warn = typeof log.warn === "function" ? log.warn.bind(log) : console.warn;
  const want = String(declaration || "").trim();
  if (!want || want === "无需添加自主声明") {
    info("跳过自主声明（未选择或无需声明）");
    return true;
  }
  if (!DY_DECLARATIONS.includes(want)) {
    warn(`未知自主声明：${want}`);
  }

  // 打开「请选择自主声明」
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("div, span, button, a, p, label")];
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t === "请选择自主声明" || t === "自主声明") {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        el.click();
        return t;
      }
    }
    return "";
  });
  if (!opened) {
    warn("未找到自主声明入口");
    return false;
  }
  info(`已打开自主声明：${opened}`);
  await page.waitForTimeout(700);

  const picked = await page.evaluate((label) => {
    const nodes = [...document.querySelectorAll("label, div, span, li, button")];
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t !== label && !t.startsWith(label)) continue;
      if (t.length > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const input = el.querySelector?.('input[type="radio"]') || el;
      (input.tagName === "INPUT" ? input : el).click();
      return t;
    }
    return "";
  }, want);

  if (!picked) {
    warn(`未点中声明项：${want}`);
    return false;
  }
  info(`已选择声明：${picked}`);
  await page.waitForTimeout(400);

  // 点确定
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button")) {
      const t = (el.textContent || "").replace(/\s+/g, "");
      if (t === "确定" || t === "确认") {
        el.click();
        return;
      }
    }
  });
  await page.waitForTimeout(500);
  return true;
}

module.exports = {
  PublishError,
  IMAGE_EXTS,
  VIDEO_EXTS,
  DY_DECLARATIONS,
  collectImages,
  resolveVideoPath,
  parseTags,
  detectCaptcha,
  waitCaptchaIfNeeded,
  clickByTexts,
  setFilesViaInput,
  fillByPlaceholders,
  waitPublishSuccess,
  enableSchedule,
  setSelfDeclaration,
};
