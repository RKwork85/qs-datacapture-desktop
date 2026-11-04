const fs = require("fs");
const { launchChromium, defaultContextOptions } = require("./browser");
const { createLogger } = require("./logger");
const { getChromium } = require("./pw");
const xhsAuth = require("./xhs/auth");
const weiboAuth = require("./weibo/auth");
const dyAuth = require("./dy/auth");

const HOME = {
  dy: "https://www.douyin.com/",
  xhs: "https://www.xiaohongshu.com/explore",
  weibo: "https://weibo.com",
};

/**
 * 附带本地 Cookie / 登录态打开抖音 / 小红书 / 微博，浏览器保持打开
 */
async function openWithCookie({ platform = "xhs", url = "", onLog } = {}) {
  const log = createLogger(onLog);
  const site = platform === "weibo" ? "weibo" : platform === "dy" ? "dy" : "xhs";
  const target = String(url || "").trim() || HOME[site];

  if (site === "dy") {
    const st = dyAuth.getCookieStatus();
    if (!st.ready) throw new Error("未找到抖音本地登录态，请先在「账号登录」完成登录");
    log.info("使用本地登录态打开抖音…");
    const onBrowserLog = (p) => (log[p.level] || log.info)(p.message);
    const browser = await launchChromium(getChromium(), {}, onBrowserLog);
    const ctxOpts = defaultContextOptions();
    if (fs.existsSync(dyAuth.DY_AUTH_PATH)) ctxOpts.storageState = dyAuth.DY_AUTH_PATH;
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    try {
      const cookie = dyAuth.loadCookie();
      if (cookie) await dyAuth.applyCookieHeader(context, cookie);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      log.info(`已打开（保持浏览器）：${target}`);
      return { ok: true, platform: "dy", url: target, cookiePath: st.cookiePath };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  if (site === "xhs") {
    const st = xhsAuth.getCookieStatus();
    if (!st.hasCookie) throw new Error("未找到小红书本地 Cookie，请先在「账号登录」完成登录");
    log.info("使用本地 Cookie 打开小红书…");
    const onBrowserLog = (p) => (log[p.level] || log.info)(p.message);
    const browser = await launchChromium(getChromium(), {}, onBrowserLog);
    const context = await browser.newContext(defaultContextOptions());
    const page = await context.newPage();
    try {
      await xhsAuth.applyCookieHeader(context, xhsAuth.loadCookie());
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      log.info(`已打开（保持浏览器）：${target}`);
      return { ok: true, platform: "xhs", url: target, cookiePath: st.cookiePath };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  const st = weiboAuth.getAuthStatus();
  if (!st.ready) throw new Error("未找到有效微博登录态，请先在「账号登录」完成登录");
  log.info("使用本地登录态打开微博…");
  const onBrowserLog = (p) => (log[p.level] || log.info)(p.message);
  const browser = await launchChromium(getChromium(), {}, onBrowserLog);
  const context = await browser.newContext({
    ...defaultContextOptions(),
    storageState: weiboAuth.WEIBO_AUTH_PATH,
  });
  const page = await context.newPage();
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
    log.info(`已打开（保持浏览器）：${target}`);
    return { ok: true, platform: "weibo", url: target, authPath: st.authPath };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { openWithCookie, HOME };
