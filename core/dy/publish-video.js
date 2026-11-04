const path = require("path");
const { createLogger } = require("../logger");
const auth = require("./auth");
const h = require("./publish-helpers");

const VIDEO_UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload";

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

async function waitVideoFileInput(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = await page.evaluate(() => {
      const list = [...document.querySelectorAll('input[type="file"]')];
      for (let i = 0; i < list.length; i += 1) {
        const acc = (list[i].getAttribute("accept") || "").toLowerCase();
        if (acc.includes("video") || acc.includes("mp4") || acc.includes(".mov")) return i;
      }
      // 仅有一个 file input 时也接受
      if (list.length === 1) return 0;
      return -1;
    });
    if (idx >= 0) return idx;
    await page.waitForTimeout(500);
  }
  return -1;
}

async function gotoVideoUpload(page, log) {
  log.info(`打开视频上传页：${VIDEO_UPLOAD_URL}`);
  await page.goto(VIDEO_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  await h.waitCaptchaIfNeeded(page, log);
  await dismissDraftDialog(page, log);

  let idx = await waitVideoFileInput(page, 5000);
  if (idx < 0) {
    await h.clickByTexts(page, ["发布视频", "上传视频"], log);
    await page.waitForTimeout(1200);
    idx = await waitVideoFileInput(page, 15000);
  }
  if (idx < 0) throw new h.PublishError("未进入视频上传界面（无视频 file input）");
  return idx;
}

async function waitVideoReady(page, log, timeoutMs = 15 * 60 * 1000) {
  log.info("等待视频上传/处理完成…");
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    await h.waitCaptchaIfNeeded(page, log);
    const state = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || "";
      const url = location.href || "";
      if (/上传失败|处理失败/.test(text)) return "fail";
      if (/重新上传/.test(text)) return "reupload";
      if (/上传成功/.test(text)) return "success";
      if (/上传中|处理中|转码|合成中/.test(text)) return "busy";
      const hasEditor =
        /作品描述|作品标题|填写作品标题|添加作品描述/.test(text) ||
        !!document.querySelector("input[placeholder*='标题'], [contenteditable='true']");
      if (hasEditor || /post\/video|publish/.test(url)) return "editor";
      return "";
    });
    if (state === "fail") throw new h.PublishError("视频上传/处理失败");
    if (state === "reupload" || state === "success" || state === "editor") {
      log.info(`视频已就绪（${state}）`);
      return true;
    }
    if (Date.now() - last > 10000) {
      log.info(state === "busy" ? "上传/处理中…" : "等待视频就绪…");
      last = Date.now();
    }
    await page.waitForTimeout(1500);
  }
  throw new h.PublishError("视频上传超时");
}

async function fillMeta(page, { title, content, tags }, log) {
  const tagList = h.parseTags(tags);
  const desc = [content, ...tagList.map((t) => `#${t}`)].filter(Boolean).join("\n");
  const titleText = String(title || "测试视频标题").slice(0, 30);

  let titleOk = await h.fillByPlaceholders(
    page,
    ["作品标题", "填写作品标题", "添加作品标题", "标题"],
    titleText,
    30
  );
  if (!titleOk) {
    titleOk = await page.evaluate((t) => {
      const inputs = [...document.querySelectorAll("input, textarea")];
      for (const el of inputs) {
        const max = Number(el.getAttribute("maxlength") || 0);
        if (max > 0 && max <= 40) {
          el.focus();
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
  else log.warn("未找到标题输入框");

  let descOk = await h.fillByPlaceholders(
    page,
    ["添加作品描述", "作品描述", "添加描述", "写描述"],
    desc || titleText
  );
  if (!descOk) {
    descOk = await page.evaluate((text) => {
      const editors = [
        ...document.querySelectorAll(
          "[contenteditable='true'], .zone-container, .editor-kit-container, .public-DraftEditor-content"
        ),
      ];
      for (const el of editors) {
        el.focus();
        el.click();
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    }, desc || titleText);
  }
  if (descOk) log.info("已填写描述");
}

async function clickPublish(page, log) {
  await h.waitCaptchaIfNeeded(page, log);
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    for (const b of buttons) {
      const t = (b.textContent || "").replace(/\s+/g, "");
      if ((t === "发布" || t === "立即发布") && !b.disabled) {
        b.click();
        return t;
      }
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
 * @param {{ videoPath: string, title?: string, content?: string, tags?: string, schedule?: boolean, scheduleTime?: string, declaration?: string, onLog?: Function }} opts
 */
async function publishVideo(opts = {}) {
  const log = createLogger(opts.onLog);
  const videoPath = h.resolveVideoPath(opts.videoPath);
  const title = String(opts.title || "").trim() || "测试视频标题";
  const content = String(opts.content || "").trim() || "这是一条抖音视频发布测试内容，请忽略。";
  const tags = String(opts.tags || "").trim() || "测试";
  const declaration = String(opts.declaration || "").trim();
  const wantSchedule = Boolean(opts.schedule);
  const scheduleTime = String(opts.scheduleTime || "").trim();

  log.info(`视频发布：${path.basename(videoPath)}`);
  log.info(`标题：${title}`);

  const { browser, context } = await auth.openContextWithAuth();
  const page = await context.newPage();
  try {
    await auth.ensureLogin(page, context, log);
    const inputIdx = await gotoVideoUpload(page, log);

    log.info("上传视频文件…");
    await page.locator('input[type="file"]').nth(inputIdx).setInputFiles(videoPath);
    await h.waitCaptchaIfNeeded(page, log);
    await waitVideoReady(page, log);
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

    const ok = await h.waitPublishSuccess(page, 180000);
    await auth.saveAuthState(context).catch(() => {});
    if (!ok) {
      log.warn("未明确检测到发布成功文案，请人工确认创作者中心");
      return { ok: true, uncertain: true, videoPath, title, scheduled: wantSchedule };
    }
    log.info(wantSchedule ? "抖音视频定时发布完成" : "抖音视频发布完成");
    return { ok: true, videoPath, title, scheduled: wantSchedule };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  PublishError: h.PublishError,
  resolveVideoPath: h.resolveVideoPath,
  publishVideo,
};
