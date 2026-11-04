/**
 * 登录/发布后的验证码检测：出现则等待用户完成，超时抛错（避免写入无效 Cookie）。
 */

async function detectCaptcha(page) {
  return page.evaluate(() => {
    const text = (document.body && document.body.innerText) || "";
    if (/滑动验证|请完成验证|安全验证|验证码|拖动滑块|人机验证|captcha|点选|依次点击/i.test(text)) {
      // 避免把页面普通「发布」文案误判；要求有验证相关容器或更强信号
      if (/滑动验证|请完成验证|安全验证|拖动滑块|人机验证|依次点击|点选文字/i.test(text)) {
        return true;
      }
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
      "[class*='geetest']",
    ];
    for (const s of sels) {
      if (document.querySelector(s)) return true;
    }
    return false;
  });
}

/**
 * @param {*} page
 * @param {{ info?: Function, warn?: Function }} log
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} 是否曾出现验证码
 */
async function waitCaptchaIfNeeded(page, log = {}, timeoutMs = 180000) {
  const info = typeof log.info === "function" ? log.info.bind(log) : console.log;
  const warn = typeof log.warn === "function" ? log.warn.bind(log) : console.warn;
  if (!(await detectCaptcha(page))) return false;
  warn("检测到验证码/安全验证，请在浏览器中完成；超时将停止（避免保存无效 Cookie）");
  const deadline = Date.now() + timeoutMs;
  let lastHint = 0;
  while (Date.now() < deadline) {
    if (!(await detectCaptcha(page))) {
      info("验证码已通过，继续执行");
      await page.waitForTimeout(800);
      return true;
    }
    if (Date.now() - lastHint > 15000) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      info(`仍在等待验证码…剩余约 ${left}s`);
      lastHint = Date.now();
    }
    await page.waitForTimeout(1200);
  }
  throw new Error("验证码等待超时，已停止（未保存 Cookie）");
}

module.exports = {
  detectCaptcha,
  waitCaptchaIfNeeded,
};
