const fs = require("fs");
const path = require("path");
const { getChromium } = require("../pw");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const auth = require("./auth");

const PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image";
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

class PublishError extends Error {}

function collectImages(folderPath) {
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return [];
  return fs
    .readdirSync(folderPath)
    .map((name) => path.join(folderPath, name))
    .filter((p) => fs.statSync(p).isFile() && IMAGE_EXTS.has(path.extname(p).toLowerCase()))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
}

function parseTags(tagsStr) {
  return String(tagsStr || "")
    .split(/[\s,，]+/)
    .map((t) =>
      String(t || "")
        .replace(/\[话题\]/g, "")
        .replace(/^#+/, "")
        .replace(/#+$/, "")
        .replace(/[\[\]【】]/g, "")
        .trim()
    )
    .filter(Boolean);
}

async function waitImagesUploaded(page, expectedCount, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counted = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      const m = text.match(/(\d+)\s*\/\s*18/);
      return m ? parseInt(m[1], 10) : null;
    });
    if (counted != null && counted >= expectedCount) return true;
    const preview = page.locator(
      ".img-upload-area img, .media-area-new img, .upload-item img, .image-item img"
    );
    if ((await preview.count()) >= expectedCount) return true;
    await page.waitForTimeout(500);
  }
  throw new PublishError(`等待图片上传超时（期望 ${expectedCount} 张）`);
}

async function uploadImages(page, imageDir, log) {
  const imagePaths = collectImages(imageDir);
  if (!imagePaths.length) throw new PublishError(`未找到可上传图片：${imageDir}`);
  log.info(`检测到 ${imagePaths.length} 张图片，准备上传`);

  const waitSelectors = [
    "div.d-button-content:has-text('上传图片')",
    "button:has-text('上传图片')",
    "text=上传图片",
    "input[type='file']",
  ];
  let ready = false;
  for (const s of waitSelectors) {
    try {
      await page.locator(s).first().waitFor({ state: "attached", timeout: 12000 });
      ready = true;
      break;
    } catch (_) {
      /* continue */
    }
  }
  if (!ready) throw new PublishError("未检测到上传入口");

  const fileInputs = page.locator("input[type='file']");
  if ((await fileInputs.count()) > 0) {
    try {
      await fileInputs.first().setInputFiles(imagePaths);
      log.info("已通过 input[type=file] 注入图片");
      await waitImagesUploaded(page, imagePaths.length);
      return true;
    } catch (e) {
      log.warn(`直接设文件失败，回退点击上传：${e.message || e}`);
    }
  }

  const buttonSelectors = [
    "div.d-button-content:has-text('上传图片')",
    "button:has-text('上传图片')",
    "text=上传图片",
  ];
  for (const selector of buttonSelectors) {
    const group = page.locator(selector);
    const count = await group.count();
    if (!count) continue;
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          group.nth(i).click({ timeout: 5000, force: true }),
        ]);
        await chooser.setFiles(imagePaths);
        await waitImagesUploaded(page, imagePaths.length);
        return true;
      } catch (_) {
        /* try next */
      }
    }
  }
  throw new PublishError("未能完成图片上传");
}

async function fillTitle(page, title) {
  const titleInput = page
    .locator("input.d-text[placeholder*='标题'], input[placeholder*='标题']")
    .first();
  await titleInput.waitFor({ state: "visible", timeout: 12000 });
  await titleInput.fill(String(title || "").slice(0, 20));
}

async function fillContent(page, content) {
  const cleaned = String(content || "").replace(/\[话题\]/g, "");
  const contentBox = page
    .locator("div.tiptap.ProseMirror[contenteditable='true'][role='textbox']")
    .first();
  await contentBox.waitFor({ state: "visible", timeout: 12000 });
  await contentBox.click();
  const ok = await page.evaluate((text) => {
    const ed = document.querySelector("div.tiptap.ProseMirror[contenteditable='true']");
    if (!ed) return false;
    ed.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    String(text)
      .split("\n")
      .forEach((line, idx, arr) => {
        if (line) document.execCommand("insertText", false, line);
        if (idx < arr.length - 1) document.execCommand("insertParagraph", false, null);
      });
    return true;
  }, cleaned);
  if (!ok) await contentBox.fill(cleaned);
}

async function clickTopicCandidate(page, topicName) {
  return page.evaluate((topic) => {
    const wantExact = ["#" + topic, topic];
    const roots = [];
    const container = document.getElementById("creator-editor-topic-container");
    if (container) roots.push(container);
    document.querySelectorAll(".tippy-content, [id*='topic']").forEach((n) => roots.push(n));
    const collectItems = (root) => {
      if (root.closest && root.closest(".recommend-topic-wrapper")) return [];
      return [...root.querySelectorAll(".item")].filter(
        (el) => !(el.closest && el.closest(".recommend-topic-wrapper"))
      );
    };
    let items = [];
    for (const root of roots) items = items.concat(collectItems(root));
    if (!items.length) return { ok: false, reason: "empty" };
    const textOf = (el) => {
      const nameEl = el.querySelector(".name");
      return ((nameEl ? nameEl.textContent : el.textContent) || "").trim();
    };
    let item = items.find((el) => wantExact.includes(textOf(el)));
    if (!item) {
      item = items.find((el) => {
        const t = textOf(el).replace(/^#/, "");
        return t === topic || t.includes(topic) || topic.includes(t);
      });
    }
    if (!item) return { ok: false, reason: "no-match" };
    item.click();
    return { ok: true, picked: textOf(item) };
  }, topicName);
}

async function addTopicTags(page, tagsStr, log) {
  const names = parseTags(tagsStr);
  if (!names.length) return;
  const contentBox = page
    .locator("div.tiptap.ProseMirror[contenteditable='true'][role='textbox']")
    .first();
  await contentBox.click();
  await page.evaluate(() => {
    const ed = document.querySelector("div.tiptap.ProseMirror[contenteditable='true']");
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertParagraph", false, null);
    document.execCommand("insertParagraph", false, null);
  });
  for (const name of names) {
    const typed = `#${name}`;
    await page.keyboard.type(typed, { delay: 35 });
    let clicked = null;
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(500);
      clicked = await clickTopicCandidate(page, name);
      if (clicked && clicked.ok) break;
    }
    if (clicked && clicked.ok) {
      log.info(`已添加话题：${clicked.picked || typed}`);
      await page.keyboard.type(" ", { delay: 20 });
    } else {
      log.warn(`未找到话题候选：${typed}`);
      await page.keyboard.press("Escape");
      for (let i = 0; i < typed.length + 1; i += 1) await page.keyboard.press("Backspace");
    }
    await page.waitForTimeout(300);
  }
}

async function readScheduleChecked(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll(".custom-switch-card, .custom-switch-wrapper");
    for (const card of cards) {
      const tip = card.querySelector(".has-tips") || card;
      if (tip && String(tip.textContent || "").includes("定时发布")) {
        const cb = card.querySelector(
          '.d-switch-simulator input[type="checkbox"], input[type="checkbox"]'
        );
        return Boolean(cb && cb.checked);
      }
    }
    return false;
  });
}

async function enableSchedule(page, scheduleTime, log) {
  let on = await readScheduleChecked(page);
  if (!on) {
    const clicked = await page.evaluate(() => {
      const cards = document.querySelectorAll(".custom-switch-card, .custom-switch-wrapper");
      for (const card of cards) {
        const tip = card.querySelector(".has-tips") || card;
        if (tip && String(tip.textContent || "").includes("定时发布")) {
          const sw = card.querySelector(".d-switch-simulator, .d-switch, [class*='switch']");
          const cb = card.querySelector('input[type="checkbox"]');
          if (sw) {
            sw.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return "switch";
          }
          if (cb) {
            cb.click();
            return "checkbox";
          }
        }
      }
      return "";
    });
    if (clicked) log.info(`已点击定时开关（${clicked}）`);
    for (let i = 0; i < 20; i += 1) {
      await page.waitForTimeout(150);
      on = await readScheduleChecked(page);
      if (on) break;
    }
  }
  if (!on) {
    log.warn("未开启定时发布开关，将按立即「发布」提交");
    return false;
  }
  if (scheduleTime) {
    const normalized = String(scheduleTime).trim().slice(0, 16);
    log.info(`定时时间配置：${normalized}`);
    try {
      const input = page
        .locator(
          ".date-picker-container input.d-text, .date-picker-container input, input[placeholder*='日期'], input[placeholder*='时间']"
        )
        .first();
      if ((await input.count()) > 0) {
        await input.click({ timeout: 3000 });
        await page.waitForTimeout(200);
        await input.fill("");
        await input.fill(normalized);
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(300);
        const actual = await input.inputValue().catch(() => "");
        if (actual && !actual.includes(normalized.slice(0, 10))) {
          log.warn(`定时时间可能未写入成功，页面值：${actual}`);
        } else {
          log.info(`已写入定时时间：${actual || normalized}`);
        }
      } else {
        log.warn("未找到定时时间输入框，页面将使用默认时间");
      }
    } catch (e) {
      log.warn(`写入定时时间失败：${e.message || e}`);
    }
  }
  await page.waitForTimeout(800);
  return true;
}

/** 小红书「添加内容类型声明」 */
async function setContentDeclaration(page, declaration, log) {
  const want = String(declaration || "").trim();
  if (!want) {
    log.info("未配置内容类型声明，跳过");
    return true;
  }
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("div, span, button, a, label, p")];
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t === "添加内容类型声明" || t.includes("内容类型声明")) {
        if (t.length > 24) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        el.click();
        return t;
      }
    }
    return "";
  });
  if (!opened) {
    log.warn("未找到「添加内容类型声明」入口");
    return false;
  }
  log.info(`已打开内容声明：${opened}`);
  await page.waitForTimeout(600);
  const picked = await page.evaluate((label) => {
    const nodes = [...document.querySelectorAll("div, span, li, button, label")];
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (!t.includes(label) || t.length > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el.click();
      return t;
    }
    return "";
  }, want);
  if (picked) log.info(`已选择内容声明：${picked}`);
  else log.warn(`未点中内容声明：${want}`);
  await page.waitForTimeout(400);
  return Boolean(picked);
}

async function waitPublishButtonReady(page, scheduled = false, timeoutMs = 180000, log) {
  const label = scheduled ? "定时发布" : "发布";
  if (log) log.info(`等待「${label}」按钮可点击...`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate((want) => {
      const widgets = [...document.querySelectorAll("xhs-publish-btn")];
      for (const el of widgets) {
        const text = (el.getAttribute("submit-text") || el.textContent || "").trim();
        if (!text.includes(want) && !(want === "发布" && text === "发布")) continue;
        if (want === "定时发布" && !text.includes("定时")) continue;
        if (want === "发布" && text.includes("定时")) continue;
        const disabled = el.getAttribute("submit-disabled");
        const loading = el.getAttribute("submit-loading");
        if (disabled === "true" || loading === "true") return "busy";
        return "ready";
      }
      // 普通 button 兜底
      for (const b of document.querySelectorAll("button")) {
        const t = (b.textContent || "").replace(/\s+/g, "");
        if (want === "定时发布" ? t.includes("定时发布") : t === "发布") {
          if (b.disabled) return "busy";
          return "ready";
        }
      }
      return "";
    }, label);
    if (state === "ready") {
      if (log) log.info(`「${label}」按钮已可点击`);
      return true;
    }
    await page.waitForTimeout(800);
  }
  throw new PublishError(`等待「${label}」按钮可点击超时`);
}

async function clickSubmitButton(page, scheduled, log) {
  const label = scheduled ? "定时发布" : "发布";
  log.info(`正在点击提交按钮：${label}`);

  // 优先走 web component 内部 API
  const viaApi = await page.evaluate((want) => {
    const widgets = [...document.querySelectorAll("xhs-publish-btn")];
    for (const el of widgets) {
      const text = (el.getAttribute("submit-text") || el.textContent || "").trim();
      const match =
        want === "定时发布"
          ? text.includes("定时发布") || text.includes("定时")
          : text === "发布" || (text.includes("发布") && !text.includes("定时"));
      if (!match) continue;
      if (el.getAttribute("submit-disabled") === "true") continue;
      if (typeof el._onPublish === "function") {
        el._onPublish();
        return text || want;
      }
      el.click();
      return text || want;
    }
    for (const b of document.querySelectorAll("button")) {
      const t = (b.textContent || "").replace(/\s+/g, "");
      if (want === "定时发布" ? t.includes("定时发布") : t === "发布" || t === "立即发布") {
        if (b.disabled) continue;
        b.click();
        return t;
      }
    }
    return "";
  }, label);

  if (viaApi) {
    log.info(`已点击「${viaApi}」`);
    return true;
  }

  const selectors = [
    `xhs-publish-btn[submit-text="${label}"]`,
    `xhs-publish-btn[submit-text*="${label}"]`,
    `button:has-text('${label}')`,
    `text=${label}`,
  ];
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) === 0) continue;
    try {
      const loc = page.locator(selector).first();
      await loc.waitFor({ state: "visible", timeout: 5000 });
      await loc.click({ timeout: 5000, force: true });
      log.info(`已点击「${label}」（${selector}）`);
      return true;
    } catch (_) {
      /* next */
    }
  }
  throw new PublishError(`未找到「${label}」按钮`);
}

async function waitPublishSuccess(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url() || "";
    if (url.includes("publish/success") || url.includes("/success")) return true;
    for (const text of ["发布成功", "定时发布成功"]) {
      try {
        if (await page.locator(`text=${text}`).first().isVisible({ timeout: 300 })) return true;
      } catch (_) {
        /* ignore */
      }
    }
    await page.waitForTimeout(400);
  }
  throw new PublishError("提交后未检测到发布成功");
}

async function publishNote({
  imageDir,
  title,
  content,
  tags = "",
  schedule = false,
  scheduleTime = "",
  declaration = "",
  onLog,
} = {}) {
  const log = createLogger(onLog);
  if (!imageDir) throw new PublishError("请指定图片目录");
  const browser = await launchChromium(getChromium());
  const context = await browser.newContext(
    defaultContextOptions({ viewport: { width: 1366, height: 900 } })
  );
  const page = await context.newPage();
  try {
    await auth.ensureLogin(page, context, log);
    log.info("正在打开发布页...");
    await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await uploadImages(page, imageDir, log);
    log.info("开始填写图文表单...");
    await fillTitle(page, title || "");
    await fillContent(page, content || "");
    await addTopicTags(page, tags, log);
    await setContentDeclaration(page, declaration, log);
    let scheduled = false;
    if (schedule) {
      scheduled = await enableSchedule(page, scheduleTime, log);
    }
    await waitPublishButtonReady(page, scheduled, 180000, log);
    await page.waitForTimeout(1200);
    await clickSubmitButton(page, scheduled, log);
    await waitPublishSuccess(page);
    log.info(scheduled ? "图文定时发布完成" : "图文发布完成");
    await page.waitForTimeout(3000);
    return { ok: true, scheduled };
  } finally {
    await browser.close();
  }
}

module.exports = {
  PublishError,
  publishNote,
  fillTitle,
  fillContent,
  addTopicTags,
  enableSchedule,
  setContentDeclaration,
  waitPublishButtonReady,
  clickSubmitButton,
  waitPublishSuccess,
};
