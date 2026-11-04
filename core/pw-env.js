const path = require("path");
const { getWritableRoot } = require("./paths");

/** 打包后把浏览器下载到可写目录，避免写入 asar / 只读安装目录 */
function setupPlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const dir = path.join(getWritableRoot(), "ms-playwright");
  process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
  return dir;
}

module.exports = { setupPlaywrightBrowsersPath };
