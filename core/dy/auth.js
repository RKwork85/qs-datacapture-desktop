const fs = require("fs");
const { DY_COOKIE_PATH, DY_AUTH_PATH, ensureDirs } = require("../paths");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const { getChromium } = require("../pw");

const HOME = "https://www.douyin.com/";
/** 抖音登录态常见关键 Cookie（可多不可少） */
const REQUIRED_COOKIE_KEYS = ["sessionid", "sid_tt"];

function loadCookie() {
  ensureDirs();
  if (!fs.existsSync(DY_COOKIE_PATH)) return "";
  return fs.readFileSync(DY_COOKIE_PATH, "utf8").trim();
}

function saveCookie(cookieStr) {
  ensureDirs();
  fs.writeFileSync(DY_COOKIE_PATH, cookieStr || "", "utf8");
}

/** 清除本地 Cookie / 登录态，清除后需重新登录 */
function clearLocalAuth() {
  ensureDirs();
  const removed = [];
  for (const p of [DY_COOKIE_PATH, DY_AUTH_PATH]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed.push(p);
    }
  }
  return { ok: true, removed, cookiePath: DY_COOKIE_PATH, authPath: DY_AUTH_PATH };
}

function cookiesToString(cookies) {
  const dy = cookies.filter((c) => (c.domain || "").includes("douyin"));
  const list = dy.length ? dy : cookies;
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

function getCookieStatus() {
  const cookie = loadCookie();
  const map = parseCookieHeader(cookie);
  const missing = REQUIRED_COOKIE_KEYS.filter((k) => !map[k]);
  let mtime = 0;
  try {
    if (fs.existsSync(DY_COOKIE_PATH)) mtime = fs.statSync(DY_COOKIE_PATH).mtimeMs;
  } catch (_) {
    /* ignore */
  }
  const hasAuthJson = fs.existsSync(DY_AUTH_PATH);
  return {
    hasCookie: Boolean(cookie) || hasAuthJson,
    ready: (Boolean(cookie) && missing.length === 0) || hasAuthJson,
    missing,
    cookiePath: DY_COOKIE_PATH,
    authPath: DY_AUTH_PATH,
    mtime,
  };
}

async function applyCookieHeader(context, cookieStr) {
  const map = parseCookieHeader(cookieStr);
  const cookies = Object.entries(map).map(([name, value]) => ({
    name,
    value,
    domain: ".douyin.com",
    path: "/",
  }));
  if (cookies.length) await context.addCookies(cookies);
}

async function cookieMap(context) {
  const cookies = await context.cookies();
  const map = {};
  for (const c of cookies) {
    if (c.name && (c.domain || "").includes("douyin")) map[c.name] = c.value || "";
  }
  return map;
}

async function waitLoginSuccess(page, context, timeoutSec = 180, log = createLogger()) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    const map = await cookieMap(context);
    const ok = REQUIRED_COOKIE_KEYS.every((k) => map[k]);
    if (ok) {
      log.info("检测到抖音登录 Cookie");
      return true;
    }
    // 登录按钮消失 / 头像出现也算
    const avatar = page.locator('[class*="avatar"], [data-e2e="user-info"], img[alt*="头像"]');
    if ((await avatar.count()) > 0) {
      const map2 = await cookieMap(context);
      if (map2.sessionid || map2.sid_tt || Object.keys(map2).length > 5) return true;
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

async function saveAuthState(context) {
  ensureDirs();
  await context.storageState({ path: DY_AUTH_PATH });
  saveCookie(cookiesToString(await context.cookies()));
}

async function ensureLogin(page, context, log = createLogger(), { forceScan = false } = {}) {
  const saved = forceScan ? "" : loadCookie();
  if (!forceScan && fs.existsSync(DY_AUTH_PATH)) {
    log.info("检测到本地抖音登录态文件");
  }
  if (saved) {
    log.info("注入本地 Cookie…");
    await applyCookieHeader(context, saved);
  }
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  if (!forceScan && (await waitLoginSuccess(page, context, 20, log))) {
    await saveAuthState(context);
    log.info("本地登录态有效");
    return true;
  }
  log.info("请在浏览器中扫码登录抖音…");
  if (!(await waitLoginSuccess(page, context, 300, log))) {
    throw new Error("登录超时，未检测到抖音登录成功");
  }
  const { waitCaptchaIfNeeded } = require("../captcha");
  await waitCaptchaIfNeeded(page, log);
  if (!(await waitLoginSuccess(page, context, 20, log))) {
    throw new Error("验证码处理后登录态无效，请重试扫码");
  }
  await saveAuthState(context);
  log.info(`已保存 Cookie -> ${DY_COOKIE_PATH}`);
  return true;
}

async function loginInteractive({ onLog, forceScan = false } = {}) {
  const log = createLogger(onLog);
  const status = getCookieStatus();
  if (!forceScan && status.ready) {
    log.info("已读取本地抖音登录态，打开并注入…");
  }
  const browser = await launchChromium(getChromium());
  const ctxOpts = defaultContextOptions();
  if (!forceScan && fs.existsSync(DY_AUTH_PATH)) {
    ctxOpts.storageState = DY_AUTH_PATH;
  }
  const context = await browser.newContext(ctxOpts);
  for (const p of context.pages()) await p.close().catch(() => {});
  const page = await context.newPage();
  try {
    await ensureLogin(page, context, log, { forceScan });
    await browser.close().catch(() => {});
    log.info("登录完成，登录态已保存");
    return {
      ok: true,
      cookiePath: DY_COOKIE_PATH,
      authPath: DY_AUTH_PATH,
      fromCache: Boolean(!forceScan && status.ready),
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

async function openContextWithAuth() {
  ensureDirs();
  const browser = await launchChromium(getChromium());
  const ctxOpts = defaultContextOptions();
  if (fs.existsSync(DY_AUTH_PATH)) ctxOpts.storageState = DY_AUTH_PATH;
  const context = await browser.newContext(ctxOpts);
  // 保证只有一个采集页，避免空白页 + 主页双开
  for (const p of context.pages()) await p.close().catch(() => {});
  const cookie = loadCookie();
  if (cookie && !fs.existsSync(DY_AUTH_PATH)) {
    await applyCookieHeader(context, cookie);
  }
  return { browser, context };
}

module.exports = {
  HOME,
  REQUIRED_COOKIE_KEYS,
  DY_COOKIE_PATH,
  DY_AUTH_PATH,
  loadCookie,
  saveCookie,
  clearLocalAuth,
  getCookieStatus,
  cookiesToString,
  parseCookieHeader,
  applyCookieHeader,
  cookieMap,
  waitLoginSuccess,
  ensureLogin,
  loginInteractive,
  openContextWithAuth,
  saveAuthState,
};
