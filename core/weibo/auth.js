const fs = require("fs");
const { WEIBO_AUTH_PATH, ensureDirs } = require("../paths");
const { launchChromium, defaultContextOptions } = require("../browser");
const { createLogger } = require("../logger");
const { getChromium } = require("../pw");

const LOGIN_URL =
  "https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog";
const VERIFY_URL =
  "https://s.weibo.com/weibo?q=%23%E5%BF%85%E9%A1%BB%E6%8C%81%E4%B9%8B%E4%BB%A5%E6%81%92%E6%8E%A8%E8%BF%9B%E5%85%A8%E9%9D%A2%E4%BB%8E%E4%B8%A5%E6%B2%BB%E5%85%9A%23";
const LOGIN_COOKIE_HINTS = ["SSOLoginState", "SCF", "ALF"];

function authFileLooksValid(filePath = WEIBO_AUTH_PATH) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const names = new Set((data.cookies || []).map((c) => c.name));
    return names.has("SUB") && LOGIN_COOKIE_HINTS.some((k) => names.has(k));
  } catch {
    return false;
  }
}

function cookiesFromAuth(filePath = WEIBO_AUTH_PATH) {
  if (!fs.existsSync(filePath)) return "";
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return (data.cookies || [])
    .filter((c) => c.name && c.value != null)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function clearInvalidLocalAuth(log = createLogger()) {
  if (fs.existsSync(WEIBO_AUTH_PATH) && !authFileLooksValid()) {
    fs.unlinkSync(WEIBO_AUTH_PATH);
    log.warn(`已删除无效访客登录态: ${WEIBO_AUTH_PATH}`);
  }
}

async function weiboCookieMap(context) {
  const cookies = await context.cookies();
  const map = {};
  for (const c of cookies) {
    if (
      c.name &&
      ((c.domain || "").includes("weibo.com") || (c.domain || "").includes("weibo.cn"))
    ) {
      map[c.name] = c.value || "";
    }
  }
  return map;
}

async function hasRealLoginCookies(context) {
  const current = await weiboCookieMap(context);
  if (!current.SUB) return false;
  return LOGIN_COOKIE_HINTS.some((k) => current[k]);
}

async function isOnLoginPage(page) {
  return (page.url() || "").toLowerCase().includes("passport.weibo.com");
}

async function pageBlockedOrNeedLogin(page) {
  const url = (page.url() || "").toLowerCase();
  if (url.includes("passport.weibo.com") || url.includes("visitor")) return true;
  try {
    const body = await page.locator("body").innerText({ timeout: 2000 });
    const markers = ["Sina Visitor System", "请先登录", "扫码登录", "微博登录"];
    if (markers.some((m) => body.includes(m))) {
      if (url.includes("s.weibo.com/weibo") || url.includes("passport") || url.includes("visitor")) {
        const feed = page.locator(
          "#pl_feedlist_index .card-wrap, .card-wrap, .vue-recycle-scroller"
        );
        if ((await feed.count()) === 0) return true;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

async function pageHasSearchResults(page) {
  for (const sel of [
    "#pl_feedlist_index .card-wrap",
    ".card-wrap",
    "div[action-type='feed_list_item']",
  ]) {
    if ((await page.locator(sel).count()) > 0) return true;
  }
  return false;
}

async function isLoggedIn(page, context) {
  if (!(await hasRealLoginCookies(context))) return false;
  if (await isOnLoginPage(page)) return false;
  if (await pageBlockedOrNeedLogin(page)) return false;
  return true;
}

async function waitLoginSuccess(page, context, timeoutSec = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    if (await hasRealLoginCookies(context)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function waitCookieLoginSuccess(page, context, timeoutSec = 15) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    if (await isLoggedIn(page, context)) return true;
    if ((await hasRealLoginCookies(context)) && (await pageHasSearchResults(page))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function saveAuthState(context) {
  if (!(await hasRealLoginCookies(context))) {
    throw new Error("拒绝保存：当前仍是访客 Cookie，请先完成真实登录");
  }
  ensureDirs();
  await context.storageState({ path: WEIBO_AUTH_PATH });
}

/** 清除本地登录态，清除后需重新登录 */
function clearLocalAuth() {
  ensureDirs();
  const removed = [];
  if (fs.existsSync(WEIBO_AUTH_PATH)) {
    fs.unlinkSync(WEIBO_AUTH_PATH);
    removed.push(WEIBO_AUTH_PATH);
  }
  return { ok: true, removed, authPath: WEIBO_AUTH_PATH };
}

function getAuthStatus(filePath = WEIBO_AUTH_PATH) {
  const ready = authFileLooksValid(filePath);
  let mtime = 0;
  try {
    if (fs.existsSync(filePath)) mtime = fs.statSync(filePath).mtimeMs;
  } catch (_) {
    /* ignore */
  }
  return { hasAuth: fs.existsSync(filePath), ready, authPath: filePath, mtime };
}

async function loginInteractive({ force = false, forceScan = false, onLog } = {}) {
  const log = createLogger(onLog);
  const forceLogin = force || forceScan;
  clearInvalidLocalAuth(log);
  if (!forceLogin && authFileLooksValid()) {
    log.info(`优先使用本地登录态，打开微博并注入 Cookie…`);
  }

  const browser = await launchChromium(getChromium());
  const ctxOpts = defaultContextOptions();
  if (!forceLogin && authFileLooksValid()) {
    ctxOpts.storageState = WEIBO_AUTH_PATH;
    log.info(`加载已保存登录态: ${WEIBO_AUTH_PATH}`);
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  try {
    log.info(`打开验证页: ${VERIFY_URL}`);
    await page.goto(VERIFY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    if (!forceLogin && (await waitCookieLoginSuccess(page, context, 15))) {
      log.info("本地登录态仍有效");
      await saveAuthState(context);
      await browser.close().catch(() => {});
      return { ok: true, authPath: WEIBO_AUTH_PATH, fromCache: true };
    }

    log.info("请扫码/账号登录微博...");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!(await waitLoginSuccess(page, context, 300))) {
      throw new Error("登录超时");
    }
    const { waitCaptchaIfNeeded } = require("../captcha");
    await waitCaptchaIfNeeded(page, log);
    await page.goto(VERIFY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    await waitCaptchaIfNeeded(page, log);
    if (!(await waitCookieLoginSuccess(page, context, 20))) {
      throw new Error("登录后验证失败");
    }
    await saveAuthState(context);
    log.info(`已保存登录态: ${WEIBO_AUTH_PATH}`);
    await browser.close().catch(() => {});
    log.info("登录完成，已关闭浏览器");
    return { ok: true, authPath: WEIBO_AUTH_PATH, fromCache: false };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = {
  WEIBO_AUTH_PATH,
  LOGIN_URL,
  VERIFY_URL,
  authFileLooksValid,
  getAuthStatus,
  clearLocalAuth,
  cookiesFromAuth,
  clearInvalidLocalAuth,
  loginInteractive,
};
