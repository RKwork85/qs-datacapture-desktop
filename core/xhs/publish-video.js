const fs = require("fs");
const path = require("path");
const { getChromium } = require("../pw");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const auth = require("./auth");
const note = require("./publish-note");

const PUBLISH_URLS = [
  "https://creator.xiaohongshu.com/publish/publish?source=official",
  "https://creator.xiaohongshu.com/publish/publish",
];
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v"]);

function resolveVideoPath(pathStr) {
  let p = path.resolve(pathStr);
  if (!fs.existsSync(p)) throw new note.PublishError(`视频不存在：${pathStr}`);
  if (fs.statSync(p).isDirectory()) {
    const files = fs
      .readdirSync(p)
      .map((name) => path.join(p, name))
      .filter((f) => fs.statSync(f).isFile() && VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
    if (!files.length) throw new note.PublishError(`目录中未找到视频：${pathStr}`);
    p = files[0];
  } else if (!VIDEO_EXTS.has(path.extname(p).toLowerCase())) {
    throw new note.PublishError(`不支持的视频后缀：${path.extname(p)}`);
  }
  return p;
}

async function enterVideoUploadUi(page, log) {
  for (let i = 0; i < 20; i += 1) {
    const body = await page.evaluate(() => (document.body && document.body.innerText) || "");
    if (["上传视频", "上传图文", "发布笔记", "视频", "图文"].some((k) => body.includes(k))) break;
    await page.waitForTimeout(500);
  }
  for (const sel of [
    "div.publish-video .btn",
    "div.publish-video",
    ".group-list .publish-card:nth-child(1)",
    ".publish-card:has-text('视频')",
  ]) {
    const loc = page.locator(sel);
    if ((await loc.count()) === 0) continue;
    try {
      if (await loc.first().isVisible({ timeout: 800 })) {
        await loc.first().click({ timeout: 3000 });
        log.info(`已点击入口：${sel}`);
        await page.waitForTimeout(1000);
        break;
      }
    } catch (_) {
      /* next */
    }
  }
  const hit = await page.evaluate((texts) => {
    const want = new Set(texts);
    for (const el of document.querySelectorAll("div, span, button, a, label, p, li")) {
      const t = (el.textContent || "").trim();
      if (!want.has(t) || t.length > 20) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el.click();
      return t;
    }
    return "";
  }, ["上传视频", "发布视频", "视频"]);
  if (hit) {
    log.info(`已点击文案入口：${hit}`);
    await page.waitForTimeout(1000);
  }
  const tab = page.locator(".creator-tab, .outarea .creator-tab, [class*='creator-tab']");
  const tabCount = await tab.count();
  if (tabCount > 0) {
    let matched = false;
    for (let i = 0; i < Math.min(tabCount, 6); i += 1) {
      const t = ((await tab.nth(i).innerText({ timeout: 500 }).catch(() => "")) || "").trim();
      if (t.includes("视频")) {
        await tab.nth(i).click({ timeout: 3000 });
        matched = true;
        await page.waitForTimeout(800);
        break;
      }
    }
    if (!matched) {
      await tab.first().click({ timeout: 3000 });
      await page.waitForTimeout(800);
    }
  }
}

async function findVideoFileInputIndex(page) {
  return page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    if (!inputs.length) return -1;
    const score = (i) => {
      const acc = (i.getAttribute("accept") || "").toLowerCase();
      const cls = (i.className || "").toLowerCase();
      let s = 0;
      if (acc.includes("video") || acc.includes("mp4") || acc.includes("mov")) s += 10;
      if (cls.includes("upload-input")) s += 5;
      if (cls.includes("upload")) s += 2;
      if (i.multiple) s -= 3;
      if (acc.includes("image") && !acc.includes("video")) s -= 8;
      return s;
    };
    let best = 0;
    let bestScore = -999;
    inputs.forEach((i, idx) => {
      const sc = score(i);
      if (sc > bestScore) {
        bestScore = sc;
        best = idx;
      }
    });
    if (bestScore < 0) return inputs.length ? 0 : -1;
    return best;
  });
}

async function waitVideoUploaded(page, timeoutMs = 15 * 60 * 1000, log) {
  log.info("等待视频上传完成（可能较久）...");
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      if (text.includes("重新上传")) return "reupload";
      if (text.includes("上传成功")) return "success";
      if (/上传中|处理中|转码/.test(text)) return "busy";
      return "";
    });
    if (ready === "reupload" || ready === "success") {
      log.info(`视频已就绪（信号：${ready}）`);
      return true;
    }
    const editorOk =
      (await page.locator("div.tiptap.ProseMirror[contenteditable='true']").count()) > 0;
    const titleOk = (await page.locator("input[placeholder*='标题']").count()) > 0;
    if (editorOk && titleOk && ready !== "busy") {
      log.info("检测到标题/正文编辑区，视为上传完成");
      return true;
    }
    if (Date.now() - lastLog > 8000) {
      log.info("上传中…");
      lastLog = Date.now();
    }
    await page.waitForTimeout(1000);
  }
  throw new note.PublishError("等待视频上传超时");
}

async function openVideoPublishPage(page, log) {
  let lastErr = null;
  for (const url of PUBLISH_URLS) {
    log.info(`正在打开：${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const cur = page.url() || "";
      if (cur.includes("creator.xiaohongshu.com") && cur.includes("/publish")) {
        lastErr = null;
        break;
      }
    }
  }
  if (lastErr) throw lastErr;
  await page.waitForTimeout(1500);
  await enterVideoUploadUi(page, log);
}

async function uploadVideo(page, videoPath, log) {
  const resolved = resolveVideoPath(videoPath);
  log.info(`准备上传视频：${resolved}`);
  await enterVideoUploadUi(page, log);
  let idx = -1;
  for (let i = 0; i < 15; i += 1) {
    idx = await findVideoFileInputIndex(page);
    if (idx >= 0) break;
    await page.waitForTimeout(500);
    await enterVideoUploadUi(page, log);
  }
  if (idx >= 0) {
    await page.locator("input[type='file']").nth(idx).setInputFiles(resolved);
    log.info(`已通过 input[type=file][${idx}] 注入视频`);
    await waitVideoUploaded(page, undefined, log);
    return true;
  }
  if ((await page.locator("input[type='file']").count()) > 0) {
    await page.locator("input[type='file']").first().setInputFiles(resolved);
    log.info("兜底：已向第一个 file input 注入视频");
    await waitVideoUploaded(page, undefined, log);
    return true;
  }
  throw new note.PublishError("无法触发视频上传");
}

async function publishVideo({
  videoPath,
  title,
  content,
  tags = "",
  schedule = false,
  scheduleTime = "",
  declaration = "",
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!videoPath) throw new note.PublishError("请指定视频路径");
  const browser = await launchChromium(getChromium());
  const context = await browser.newContext(
    defaultContextOptions({ viewport: { width: 1366, height: 900 } })
  );
  const page = await context.newPage();
  try {
    await auth.ensureLogin(page, context, log);
    await openVideoPublishPage(page, log);
    await uploadVideo(page, videoPath, log);
    log.info("开始填写视频表单...");
    await note.fillTitle(page, title || "");
    await note.fillContent(page, content || "");
    await note.addTopicTags(page, tags, log);
    await note.setContentDeclaration(page, declaration, log);
    let scheduled = false;
    if (schedule) scheduled = await note.enableSchedule(page, scheduleTime, log);
    await note.waitPublishButtonReady(page, scheduled, 180000, log);
    await page.waitForTimeout(1200);
    await note.clickSubmitButton(page, scheduled, log);
    await note.waitPublishSuccess(page);
    log.info(scheduled ? "视频定时发布完成" : "视频发布完成");
    await page.waitForTimeout(3000);
    return { ok: true, scheduled };
  } finally {
    await browser.close();
  }
}

module.exports = { publishVideo };
