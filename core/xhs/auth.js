const fs = require("fs");
const { XHS_COOKIE_PATH, ensureDirs } = require("../paths");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const { getChromium } = require("../pw");

const REQUIRED_COOKIE_KEYS = ["a1", "web_session", "webId"];

function loadCookie() {
  ensureDirs();
  if (!fs.existsSync(XHS_COOKIE_PATH)) return "";
  return fs.readFileSync(XHS_COOKIE_PATH, "utf8").trim();
}

/** 不打开浏览器，仅根据本地文件判断是否具备登录 Cookie */
function getCookieStatus() {
  const cookie = loadCookie();
  const map = parseCookieHeader(cookie);
  const missing = REQUIRED_COOKIE_KEYS.filter((k) => !map[k]);
  let mtime = 0;
  try {
    if (fs.existsSync(XHS_COOKIE_PATH)) mtime = fs.statSync(XHS_COOKIE_PATH).mtimeMs;
  } catch (_) {
    /* ignore */
  }
  return {
    hasCookie: Boolean(cookie),
    ready: Boolean(cookie) && missing.length === 0,
    missing,
    cookiePath: XHS_COOKIE_PATH,
    mtime,
  };
}

function saveCookie(cookieStr) {
  ensureDirs();
  fs.writeFileSync(XHS_COOKIE_PATH, cookieStr || "", "utf8");
}

/** 清除本地 Cookie，清除后需重新登录 */
function clearLocalAuth() {
  ensureDirs();
  const removed = [];
  if (fs.existsSync(XHS_COOKIE_PATH)) {
    fs.unlinkSync(XHS_COOKIE_PATH);
    removed.push(XHS_COOKIE_PATH);
  }
  return { ok: true, removed, cookiePath: XHS_COOKIE_PATH };
}

function cookiesToString(cookies) {
  const xhs = cookies.filter((c) => (c.domain || "").includes("xiaohongshu"));
  const list = xhs.length ? xhs : cookies;
  return list
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join(";");
}

function parseCookieHeader(cookieStr) {
  const result = {};
  for (const part of String(cookieStr || "").split(";")) {
    const item = part.trim();
    if (!item || !item.includes("=")) continue;
    const idx = item.indexOf("=");
    const k = item.slice(0, idx).trim();
    if (k) result[k] = item.slice(idx + 1).trim();
  }
  return result;
}

async function applyCookieHeader(context, cookieStr) {
  const map = parseCookieHeader(cookieStr);
  const cookies = Object.entries(map).map(([name, value]) => ({
    name,
    value,
    domain: ".xiaohongshu.com",
    path: "/",
  }));
  if (cookies.length) await context.addCookies(cookies);
}

async function cookieMap(context) {
  const cookies = await context.cookies();
  const map = {};
  for (const c of cookies) {
    if (c.name && (c.domain || "").includes("xiaohongshu")) map[c.name] = c.value || "";
  }
  return map;
}

async function isLoggedIn(page, context) {
  try {
    const userEntry = page.locator(".main-container .user .link-wrapper .channel");
    if ((await userEntry.count()) > 0 && (await userEntry.first().isVisible())) {
      const current = await cookieMap(context);
      return REQUIRED_COOKIE_KEYS.every((k) => current[k]);
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

async function waitLoginSuccess(page, context, timeoutSec = 180, log = createLogger()) {
  const start = Date.now();
  const initial = await cookieMap(context);
  while (Date.now() - start < timeoutSec * 1000) {
    const userEntry = page.locator(".main-container .user .link-wrapper .channel");
    const userVisible =
      (await userEntry.count()) > 0 && (await userEntry.first().isVisible().catch(() => false));
    const loginModal = page.locator(".login-container");
    const modalVisible =
      (await loginModal.count()) > 0 && (await loginModal.first().isVisible().catch(() => false));
    const current = await cookieMap(context);
    const hasRequired = REQUIRED_COOKIE_KEYS.every((k) => current[k]);
    const sessionChanged = (current.web_session || "") !== (initial.web_session || "");
    if (userVisible && hasRequired) return true;
    if (!modalVisible && sessionChanged && hasRequired) return true;
    await page.waitForTimeout(1000);
  }
  log.warn("等待扫码登录超时");
  return false;
}

async function waitCookieLoginSuccess(page, context, timeoutSec = 10) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    if (await isLoggedIn(page, context)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function ensureLogin(page, context, log = createLogger(), { forceScan = false } = {}) {
  const saved = forceScan ? "" : loadCookie();
  if (saved) {
    log.info("检测到本地 Cookie，优先使用本地记录登录...");
    await applyCookieHeader(context, saved);
  }
  await page.goto("https://www.xiaohongshu.com/explore", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if (saved && (await waitCookieLoginSuccess(page, context, 30))) {
    log.info("本地 Cookie 登录成功");
    // 刷新落盘，保持最新
    saveCookie(cookiesToString(await context.cookies()));
    return true;
  }
  if (saved) log.warn("本地 Cookie 已失效，转为扫码登录...");
  else log.info("请在浏览器中扫码登录...");
  if (!(await waitLoginSuccess(page, context, 300, log))) {
    throw new Error("登录超时，未检测到登录成功");
  }
  const { waitCaptchaIfNeeded } = require("../captcha");
  await waitCaptchaIfNeeded(page, log);
  // 验证码通过后再确认登录态仍有效
  if (!(await waitCookieLoginSuccess(page, context, 15))) {
    throw new Error("验证码处理后登录态无效，请重试扫码");
  }
  const cookieStr = cookiesToString(await context.cookies());
  saveCookie(cookieStr);
  log.info(`已保存 Cookie -> ${XHS_COOKIE_PATH}`);
  return true;
}

async function loginInteractive({ onLog, forceScan = false } = {}) {
  const log = createLogger(onLog);
  const status = getCookieStatus();
  if (!forceScan && status.ready) {
    log.info(`已读取本地 Cookie，打开小红书并注入登录态…`);
  } else if (!forceScan && status.hasCookie) {
    log.info("本地 Cookie 不完整，将打开浏览器验证…");
  }
  const browser = await launchChromium(getChromium());
  const context = await browser.newContext(defaultContextOptions());
  for (const p of context.pages()) await p.close().catch(() => {});
  const page = await context.newPage();
  try {
    await ensureLogin(page, context, log, { forceScan });
    await browser.close().catch(() => {});
    log.info("登录完成，登录态已保存");
    return {
      ok: true,
      cookiePath: XHS_COOKIE_PATH,
      fromCache: Boolean(!forceScan && status.ready),
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = {
  REQUIRED_COOKIE_KEYS,
  loadCookie,
  getCookieStatus,
  saveCookie,
  clearLocalAuth,
  cookiesToString,
  parseCookieHeader,
  applyCookieHeader,
  cookieMap,
  isLoggedIn,
  waitLoginSuccess,
  waitCookieLoginSuccess,
  ensureLogin,
  loginInteractive,
};
