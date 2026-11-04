/**
 * Playwright 懒加载：避免 Electron 启动时同步拉起整个 playwright。
 * 仅在真正打开浏览器 / 执行采集时再 require。
 */
const { setupPlaywrightBrowsersPath } = require("./pw-env");

let chromium = null;

function getChromium() {
  if (!chromium) {
    setupPlaywrightBrowsersPath();
    ({ chromium } = require("playwright"));
  }
  return chromium;
}

module.exports = { getChromium };
