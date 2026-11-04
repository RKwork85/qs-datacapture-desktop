const path = require("path");
const { createLogger } = require("../logger");
const auth = require("./auth");
const h = require("./publish-helpers");

const IMAGE_UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload?default-tab=3";

async function dismissDraftDialog(page, log) {
  const hit = await page.evaluate(() => {
    const text = (document.body && document.body.innerText) || "";
    if (!/继续编辑|未发布/.test(text)) return "";
    for (const el of document.querySelectorAll("button, div, span")) {
      const t = (el.textContent || "").trim();
      if (t === "放弃") {
        el.click();
        return "放弃";
      }
    }
    return "";
  });
  if (hit) {
    log.info(`已关闭草稿弹窗：${hit}`);
    await page.waitForTimeout(1000);
  }
}

async function waitImageFileInput(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = await page.evaluate(() => {
      const list = [...document.querySelectorAll('input[type="file"]')];
      for (let i = 0; i < list.length; i += 1) {
        const acc = (list[i].getAttribute("accept") || "").toLowerCase();
        if (acc.includes("image") || acc.includes("png") || acc.includes("jpeg")) return i;
      }
      return -1;
    });
    if (idx >= 0) return idx;
    await page.waitForTimeout(500);
  }
  return -1;
}

async function gotoImageUpload(page, log) {
  log.info(`打开图文上传页：${IMAGE_UPLOAD_URL}`);
  await page.goto(IMAGE_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  await h.waitCaptchaIfNeeded(page, log);
  await dismissDraftDialog(page, log);

  // 若仍在视频 Tab，点「发布图文」
  let idx = await waitImageFileInput(page, 5000);
  if (idx < 0) {
    await h.clickByTexts(page, ["发布图文", "上传图文"], log);
    await page.waitForTimeout(1500);
    await dismissDraftDialog(page, log);
    idx = await waitImageFileInput(page, 15000);
  }
  if (idx < 0) throw new h.PublishError("未进入图文上传界面（无图片 file input）");
  return idx;
}

async function waitImagesReady(page, expectCount, log, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    await h.waitCaptchaIfNeeded(page, log);
    const info = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || "";
      const url = location.href || "";
      const imgs = document.querySelectorAll(
        "img[src^='blob:'], img[src*='douyinpic'], img[src*='byteimg'], .preview img, [class*='preview'] img"
      ).length;
      const hasDesc =
        /作品描述|添加作品描述|作品标题|填写作品标题/.test(text) ||
        !!document.querySelector("input[placeholder*='标题'], textarea[placeholder*='描述'], [contenteditable='true']");
      return { text, url, imgs, hasDesc };
    });
    // 上传页本身也可能含「作品」字样，需等编辑页或预览图出现
    const onEdit =
      /post\/image/.test(info.url) ||
      (/作品描述|添加作品描述/.test(info.text) && !/点击上传\s*或直接将图片/.test(info.text));
    if (onEdit || info.imgs >= Math.min(1, expectCount)) {
      log.info(`已进入图文编辑页（预览约 ${info.imgs} 张）`);
      await page.waitForTimeout(800);
      return true;
    }
    if (/上传成功/.test(info.text) && info.imgs >= 1) {
      log.info("图片上传成功");
      return true;
    }
    if (Date.now() - last > 8000) {
      log.info("等待图片上传/进入编辑页…");
      last = Date.now();
    }
    await page.waitForTimeout(1000);
  }
  throw new h.PublishError(`图片上传超时（期望约 ${expectCount} 张）`);
}

async function fillMeta(page, { title, content, tags }, log) {
  const tagList = h.parseTags(tags);
  const desc = [content, ...tagList.map((t) => `#${t}`)].filter(Boolean).join("\n");
  const titleText = String(title || "测试图文标题").slice(0, 20);

  // 抖音图文标题常在「作品描述」上方短输入框 / placeholder 含 0/20
  let titleOk = await h.fillByPlaceholders(
    page,
    ["作品标题", "填写作品标题", "添加作品标题", "标题"],
    titleText,
    20
  );
  if (!titleOk) {
    titleOk = await page.evaluate((t) => {
      const inputs = [...document.querySelectorAll("input, textarea")];
      for (const el of inputs) {
        const ph = (el.getAttribute("placeholder") || "") + (el.getAttribute("maxlength") || "");
        const max = Number(el.getAttribute("maxlength") || 0);
        if (max === 20 || /标题|0\/20/.test(ph) || max > 0 && max <= 30) {
          el.focus();
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.value = t;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, titleText);
  }
  if (titleOk) log.info("已填写标题");
  else log.warn("未找到标题输入，写入描述区");

  let descOk = await h.fillByPlaceholders(
    page,
    ["添加作品描述", "作品描述", "添加描述", "写描述"],
    desc || titleText
  );
  if (!descOk) {
    descOk = await page.evaluate((text) => {
      const editors = [
        ...document.querySelectorAll("[contenteditable='true'], .zone-container, .editor-kit-container, .public-DraftEditor-content"),
      ];
      for (const el of editors) {
        el.focus();
        el.click();
        // 清空并写入
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    }, desc || titleText);
  }
  if (descOk) log.info("已填写描述");
  else log.warn("描述填写可能失败，继续尝试发布");
}

async function clickPublish(page, log) {
  await h.waitCaptchaIfNeeded(page, log);
  // 优先底部「发布」主按钮
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const scored = [];
    for (const b of buttons) {
      const t = (b.textContent || "").replace(/\s+/g, "");
      if (!t || t.includes("定时") || t.includes("暂存")) continue;
      if (t === "发布" || t === "立即发布") {
        if (b.disabled) continue;
        scored.push({ el: b, score: t === "发布" ? 2 : 1 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored[0]) {
      scored[0].el.click();
      return scored[0].el.textContent.trim();
    }
    return "";
  });
  if (clicked) {
    log.info(`已点击发布：${clicked}`);
    await page.waitForTimeout(1500);
    await h.waitCaptchaIfNeeded(page, log);
    return true;
  }
  if (await h.clickByTexts(page, ["发布", "立即发布"], log)) {
    await h.waitCaptchaIfNeeded(page, log);
    return true;
  }
  return false;
}

/**
 * @param {{ imageDir?: string, imageFolder?: string, title?: string, content?: string, tags?: string, schedule?: boolean, scheduleTime?: string, declaration?: string, onLog?: Function }} opts
 */
async function publishNote(opts = {}) {
  const log = createLogger(opts.onLog);
  const folder = path.resolve(String(opts.imageDir || opts.imageFolder || "").trim());
  const images = h.collectImages(folder);
  if (!images.length) throw new h.PublishError(`图片文件夹无效或无图片：${folder}`);

  const title = String(opts.title || "").trim() || "测试图文标题";
  const content = String(opts.content || "").trim() || "这是一条抖音图文发布测试内容，请忽略。";
  const tags = String(opts.tags || "").trim() || "测试 养生茶";
  const declaration = String(opts.declaration || "").trim();
  const wantSchedule = Boolean(opts.schedule);
  const scheduleTime = String(opts.scheduleTime || "").trim();

  log.info(`图文发布：${images.length} 张图 | ${folder}`);
  log.info(`标题：${title}`);

  const { browser, context } = await auth.openContextWithAuth();
  const page = await context.newPage();
  try {
    await auth.ensureLogin(page, context, log);
    const inputIdx = await gotoImageUpload(page, log);

    log.info("上传图片…");
    const input = page.locator('input[type="file"]').nth(inputIdx);
    await input.setInputFiles(images.slice(0, 35));
    await h.waitCaptchaIfNeeded(page, log);
    await waitImagesReady(page, images.length, log);
    await page.waitForTimeout(1200);

    await fillMeta(page, { title, content, tags }, log);
    await page.waitForTimeout(600);
    await h.setSelfDeclaration(page, declaration, log);
    if (wantSchedule) {
      const okSch = await h.enableSchedule(page, scheduleTime, log);
      if (!okSch) log.warn("定时发布设置可能未生效，请人工确认");
    }
    await page.waitForTimeout(800);

    const clicked = await clickPublish(page, log);
    if (!clicked) throw new h.PublishError("未找到发布按钮");

    const ok = await h.waitPublishSuccess(page, 120000);
    await auth.saveAuthState(context).catch(() => {});
    if (!ok) {
      log.warn("未明确检测到发布成功文案，请人工确认创作者中心");
      return { ok: true, uncertain: true, imageCount: images.length, title, scheduled: wantSchedule };
    }
    log.info(wantSchedule ? "抖音图文定时发布完成" : "抖音图文发布完成");
    return { ok: true, imageCount: images.length, title, scheduled: wantSchedule };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  PublishError: h.PublishError,
  collectImages: h.collectImages,
  parseTags: h.parseTags,
  publishNote,
};
